import { InteractionContextType, REST, Routes } from 'discord.js';
import { loadEnv, missingEnv } from './env.js';
import { collectModules } from './modules.js';

/** Converts loaded commands into the JSON Discord expects. Guild-only commands are hidden in DMs. */
export function commandPayload(commands) {
  return [...commands.values()].map((command) => {
    const json = command.data.toJSON();
    if (command.guildOnly !== false) json.contexts ??= [InteractionContextType.Guild];
    return json;
  });
}

/**
 * Registers a bot's slash commands.
 * Flags: --global registers application-wide (slow to propagate); --clear removes them all.
 * Without --global, GUILD_ID is required and commands appear instantly in that server.
 */
export async function deployCommands({ rootDir, config, argv = process.argv.slice(2) }) {
  loadEnv(rootDir);
  const missing = missingEnv(['DISCORD_TOKEN', 'CLIENT_ID']);
  if (missing.length) {
    console.error(`${config.name}: missing ${missing.join(', ')} in ${rootDir}/.env`);
    process.exitCode = 1;
    return;
  }
  const global = argv.includes('--global');
  const clear = argv.includes('--clear');
  const guildId = process.env.GUILD_ID;
  if (!global && !guildId) {
    console.error(`${config.name}: set GUILD_ID for a server deployment, or pass --global.`);
    process.exitCode = 1;
    return;
  }

  const { commands } = await collectModules(rootDir, config);
  const body = clear ? [] : commandPayload(commands);
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  const route = global
    ? Routes.applicationCommands(process.env.CLIENT_ID)
    : Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId);

  const result = await rest.put(route, { body });
  console.log(`${config.name}: ${clear ? 'cleared' : `registered ${result.length}`} command(s) ${global ? 'globally' : `in guild ${guildId}`}.`);
}
