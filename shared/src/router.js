import { MESSAGE_LIMITS } from './embedBuilder/validators.js';
import { hasTier, parseTier, TIER_LABELS } from './permissions.js';
import { UserError } from './errorReporter.js';
import { respond } from './utils/safeSend.js';

/**
 * Custom ID format: `namespace:feature:action[:arg...]`, e.g. `community:pet:feed:42`.
 */
export function makeCustomId(namespace, feature, action, ...args) {
  const id = [namespace, feature, action, ...args.map(String)].join(':');
  if (id.length > MESSAGE_LIMITS.customId) throw new Error(`Custom ID too long (${id.length}): ${id}`);
  return id;
}

export function parseCustomId(customId) {
  const [namespace, feature, action, ...args] = String(customId).split(':');
  if (!namespace || !feature || !action) return null;
  return { namespace, feature, action, args, key: `${feature}:${action}` };
}

function subcommandKey(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  return [group, sub].filter(Boolean).join(' ') || null;
}

/** Simple sliding-window limiter, keyed by user. */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5_000) {
      for (const [k, times] of hits) if (!times.some((t) => now - t < windowMs)) hits.delete(k);
    }
    return recent.length <= limit;
  };
}

/**
 * Dispatches every interaction to its command or component handler, enforcing
 * guild-only use, permission tiers, cooldowns and central error handling.
 */
export function createRouter(ctx, { defaultCooldownMs = 2_000, componentLimit = { limit: 8, windowMs: 5_000 } } = {}) {
  const { config, commands, components, permissions, embeds, errors } = ctx;
  const cooldowns = new Map();
  const componentAllowed = createRateLimiter(componentLimit);

  async function deny(interaction, title, description) {
    if (interaction.isAutocomplete()) return interaction.respond([]).catch(() => {});
    const kit = embeds.for(interaction.guildId);
    return respond(interaction, { embeds: [kit.error(title, description)] }, { ephemeral: true });
  }

  function checkTier(interaction, required) {
    const tier = permissions.tierOf(interaction);
    if (hasTier(tier, required)) return null;
    return `This needs the **${TIER_LABELS[parseTier(required)]}** permission tier.`;
  }

  function checkCooldown(interaction, command) {
    const ms = (command.cooldown ?? defaultCooldownMs / 1000) * 1000;
    if (ms <= 0) return null;
    const key = `${command.data.name}:${interaction.user.id}`;
    const now = Date.now();
    const until = cooldowns.get(key) ?? 0;
    if (until > now) return until;
    cooldowns.set(key, now + ms);
    if (cooldowns.size > 10_000) for (const [k, v] of cooldowns) if (v <= now) cooldowns.delete(k);
    return null;
  }

  async function handleCommand(interaction) {
    const command = commands.get(interaction.commandName);
    if (!command) return deny(interaction, 'Unknown command', 'This command is no longer available. It may have been removed in an update.');
    if (command.guildOnly !== false && !interaction.inGuild()) {
      return deny(interaction, 'Server only', 'This command can only be used inside a server.');
    }
    const sub = interaction.isChatInputCommand() ? subcommandKey(interaction) : null;
    const required = (sub && command.subcommandTiers?.[sub]) ?? command.tier ?? 'member';
    const problem = checkTier(interaction, required);
    if (problem) return deny(interaction, 'Missing permission', problem);

    const until = checkCooldown(interaction, command);
    if (until) return deny(interaction, 'Slow down', `You can use this command again <t:${Math.ceil(until / 1000)}:R>.`);
    return command.execute(interaction, ctx);
  }

  async function handleAutocomplete(interaction) {
    const command = commands.get(interaction.commandName);
    if (!command?.autocomplete) return interaction.respond([]);
    // Never leak admin-only choices (e.g. setting names) to members without access.
    const sub = subcommandKey(interaction);
    const required = (sub && command.subcommandTiers?.[sub]) ?? command.tier ?? 'member';
    if (checkTier(interaction, required)) return interaction.respond([]);
    return command.autocomplete(interaction, ctx);
  }

  async function handleComponent(interaction) {
    const parsed = parseCustomId(interaction.customId);
    // Other bots' components never reach this client, but ignore foreign IDs defensively.
    if (parsed && parsed.namespace !== config.namespace) return undefined;
    const component = parsed && components.get(parsed.key);
    if (!component) {
      return deny(interaction, 'This has expired', 'This control is no longer active. Please run the command again.');
    }
    if (component.guildOnly !== false && !interaction.inGuild()) {
      return deny(interaction, 'Server only', 'This can only be used inside a server.');
    }
    const problem = checkTier(interaction, component.tier ?? 'member');
    if (problem) return deny(interaction, 'Missing permission', problem);
    if (!componentAllowed(interaction.user.id)) {
      return deny(interaction, 'Slow down', 'You are clicking too quickly. Please wait a moment.');
    }
    return component.execute(interaction, ctx, parsed.args);
  }

  function describe(interaction) {
    if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
      const sub = subcommandKey(interaction);
      return `command:/${interaction.commandName}${sub ? ` ${sub}` : ''}`;
    }
    if (interaction.isCommand()) return `command:${interaction.commandName}`;
    return `component:${interaction.customId}`;
  }

  function contextOf(interaction) {
    return {
      source: describe(interaction),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user?.id,
    };
  }

  return {
    async handle(interaction) {
      try {
        if (interaction.isAutocomplete()) return await handleAutocomplete(interaction);
        if (interaction.isCommand()) return await handleCommand(interaction);
        if (interaction.isMessageComponent() || interaction.isModalSubmit()) return await handleComponent(interaction);
      } catch (error) {
        if (interaction.isAutocomplete()) {
          await interaction.respond([]).catch(() => {});
          if (!(error instanceof UserError)) await errors.report(error, contextOf(interaction));
          return undefined;
        }
        if (error instanceof UserError) {
          return deny(interaction, error.title, error.message).catch(() => {});
        }
        const ref = await errors.report(error, contextOf(interaction));
        const kit = embeds.for(interaction.guildId);
        await respond(interaction, { embeds: [kit.error('Something went wrong', `Something went wrong. Reference: \`${ref}\`.`)] }, { ephemeral: true })
          .catch(() => {});
      }
      return undefined;
    },
  };
}
