import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { backupDatabase } from './backup.js';
import { openDatabase } from './db.js';
import { createEmbedStyle } from './embedStyle.js';
import { loadEnv, missingEnv, ownerIdsFromEnv } from './env.js';
import { createErrorReporter } from './errorReporter.js';
import { createGuildConfig } from './guildConfig.js';
import { loadEvents, loadJobs } from './loader.js';
import { createLogger } from './logger.js';
import { collectModules } from './modules.js';
import { createPermissions } from './permissions.js';
import { createRouter } from './router.js';
import { createScheduler } from './scheduler.js';
import { createStatusRotator } from './statusRotator.js';

const DAY_MS = 86_400_000;

function readVersion(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Maps Discord login failures to an actionable message. */
function explainLoginError(error, config) {
  const message = String(error?.message ?? error);
  if (error?.code === 'TokenInvalid' || /invalid token/i.test(message)) {
    return 'DISCORD_TOKEN was rejected by Discord. Reset the token in the Developer Portal and update .env.';
  }
  if (/disallowed intents/i.test(message)) {
    return `Discord refused the requested gateway intents (${config.intents.join(', ')}). Enable the privileged intents for this application under Developer Portal › Bot › Privileged Gateway Intents.`;
  }
  return `Could not log in to Discord: ${message}`;
}

function registerBuiltinJobs(ctx) {
  const { config, db, scheduler, logger, rootDir } = ctx;

  scheduler.every('shared:retention', DAY_MS, () => {
    const now = Date.now();
    const errorsRemoved = db.prepare('DELETE FROM error_log WHERE created_at < ?').run(now - config.retention.errorLogDays * DAY_MS).changes;
    const jobsRemoved = db.prepare(`DELETE FROM scheduled_tasks WHERE status IN ('done', 'cancelled', 'failed') AND completed_at < ?`)
      .run(now - config.retention.finishedJobDays * DAY_MS).changes;
    if (errorsRemoved || jobsRemoved) logger.info('Retention cleanup', { errorsRemoved, jobsRemoved });
  });

  if (config.backup.enabled) {
    const destDir = path.resolve(process.env.BACKUP_DIR || path.join(rootDir, '..', 'backups'), config.namespace);
    scheduler.every('shared:backup', config.backup.intervalHours * 3_600_000, async () => {
      const file = await backupDatabase(db, destDir, { prefix: config.namespace, keep: config.backup.keep });
      logger.info('Database backup created', { file });
    });
  }
}

/**
 * Starts one bot: environment, database, migrations, modules, router, scheduler,
 * status rotation, error handling and graceful shutdown.
 * @returns {Promise<object | null>} The bot context, or null if startup failed.
 */
export async function startBot({ rootDir, config }) {
  loadEnv(rootDir);
  const logger = createLogger({ name: config.namespace, logDir: path.join(rootDir, 'data', 'logs') });
  const missing = missingEnv(config.requiredEnv);
  if (missing.length) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env in ${path.basename(rootDir)}/ and fill them in.`);
    process.exitCode = 1;
    return null;
  }

  const version = readVersion(rootDir);
  const db = openDatabase(path.join(rootDir, 'data', config.databaseFile), {
    migrations: [{ namespace: config.namespace, dir: path.join(rootDir, 'src', 'db', 'migrations') }],
    logger,
  });
  const guildConfig = createGuildConfig(db, config.guildDefaults);
  const client = new Client({
    intents: config.intents.map((name) => GatewayIntentBits[name]),
    partials: config.partials.map((name) => Partials[name]),
    allowedMentions: { parse: [], repliedUser: false },
  });
  const embeds = createEmbedStyle({ brand: config.brand, emojis: config.emojis, guildConfig, iconURL: () => client.user?.displayAvatarURL() ?? null });
  const errors = createErrorReporter({ botName: config.name, db, logger, client, guildConfig, embeds, defaultGuildId: process.env.GUILD_ID });
  const scheduler = createScheduler({ db, logger, errors });
  const permissions = createPermissions({ guildConfig, ownerIds: ownerIdsFromEnv() });
  const { commands, components } = await collectModules(rootDir, config);

  const ctx = {
    config, version, rootDir, client, db, logger, guildConfig, embeds, errors, scheduler, permissions, commands, components,
    startedAt: Date.now(),
  };

  registerBuiltinJobs(ctx);
  for (const job of await loadJobs(path.join(rootDir, 'src', 'jobs'))) {
    const run = (payload, task) => job.execute(payload, task, ctx);
    if (job.every) scheduler.every(job.type, job.every, run);
    else scheduler.register(job.type, run);
  }

  const router = createRouter(ctx, { defaultCooldownMs: config.defaultCooldownSeconds * 1000 });
  client.on(Events.InteractionCreate, (interaction) => router.handle(interaction));

  for (const event of await loadEvents(path.join(rootDir, 'src', 'events'))) {
    const run = async (...args) => {
      try {
        await event.execute(...args, ctx);
      } catch (error) {
        await errors.report(error, { source: `event:${event.name}` });
      }
    };
    if (event.once) client.once(event.name, run);
    else client.on(event.name, run);
  }

  const rotator = createStatusRotator({ client, entries: config.status, intervalMs: config.statusIntervalMs, version, logger });
  client.once(Events.ClientReady, (ready) => {
    logger.info('Logged in', { user: ready.user.tag, guilds: ready.guilds.cache.size, commands: commands.size, version });
    rotator.start();
    scheduler.start();
  });
  client.on(Events.Error, (error) => errors.report(error, { source: 'client' }));
  client.on(Events.Warn, (message) => logger.warn(message));
  client.on(Events.ShardDisconnect, (event, shardId) => logger.warn('Gateway disconnected', { shardId, code: event?.code }));
  client.on(Events.ShardResume, (shardId) => logger.info('Gateway resumed', { shardId }));

  process.on('unhandledRejection', (reason) => {
    errors.report(reason instanceof Error ? reason : new Error(String(reason)), { source: 'process:unhandledRejection' });
  });
  process.on('uncaughtException', async (error) => {
    await errors.report(error, { source: 'process:uncaughtException' }).catch(() => {});
    // State may be corrupt; exit and let PM2 / Docker restart the process.
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    rotator.stop();
    scheduler.stop();
    await client.destroy().catch(() => {});
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await client.login(process.env.DISCORD_TOKEN);
  } catch (error) {
    logger.error(explainLoginError(error, config));
    scheduler.stop();
    await client.destroy().catch(() => {});
    db.close();
    process.exitCode = 1;
    return null;
  }
  return ctx;
}
