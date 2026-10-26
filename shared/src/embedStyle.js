import { EmbedBuilder } from 'discord.js';
import { parseColour, EMBED_LIMITS } from './embedBuilder/validators.js';
import { truncate } from './utils/text.js';

const STATE_COLOURS = Object.freeze({
  success: '#57F287',
  warning: '#FEE75C',
  error: '#ED4245',
});

export const DEFAULT_EMOJIS = Object.freeze({
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  loading: '⏳',
  bullet: '•',
  set: '✅',
  missing: '⚠️',
  unset: '▫️',
});

/**
 * Shared embed factory. Colours, footer and emojis come from the bot's config.js
 * and can be overridden per guild via `brand.primary`, `brand.secondary` and `brand.footer`.
 */
export function createEmbedStyle({ brand, emojis = {}, guildConfig, iconURL = () => null }) {
  const icons = { ...DEFAULT_EMOJIS, ...emojis };

  return {
    emojis: icons,
    for(guildId) {
      const primary = parseColour(guildConfig?.get(guildId, 'brand.primary') ?? brand.primary) ?? 0x5865f2;
      const secondary = parseColour(guildConfig?.get(guildId, 'brand.secondary') ?? brand.secondary) ?? primary;
      const footer = guildConfig?.get(guildId, 'brand.footer') ?? brand.footer;

      const base = ({ title, description, colour = primary } = {}) => {
        const embed = new EmbedBuilder().setColor(colour).setTimestamp();
        if (title) embed.setTitle(truncate(title, EMBED_LIMITS.title));
        if (description) embed.setDescription(truncate(description, EMBED_LIMITS.description));
        if (footer) embed.setFooter({ text: truncate(footer, EMBED_LIMITS.footer), iconURL: iconURL() ?? undefined });
        return embed;
      };
      const state = (kind, colour) => (title, description) => base({
        title: `${icons[kind]} ${title}`,
        description,
        colour,
      });

      return {
        emojis: icons,
        colours: { primary, secondary },
        base,
        success: state('success', parseColour(STATE_COLOURS.success)),
        warning: state('warning', parseColour(STATE_COLOURS.warning)),
        error: state('error', parseColour(STATE_COLOURS.error)),
        info: state('info', secondary),
        loading: state('loading', secondary),
      };
    },
  };
}
