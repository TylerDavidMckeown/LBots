import { EmbedBuilder } from 'discord.js';
import { parseColour, validateEmbed } from './validators.js';

/**
 * Builds a validated EmbedBuilder from a plain object (as stored in embed templates).
 * @returns {{ embed: EmbedBuilder | null, errors: string[] }}
 */
export function buildEmbed(spec) {
  const errors = validateEmbed(spec);
  if (errors.length) return { embed: null, errors };

  const embed = new EmbedBuilder();
  if (spec.title) embed.setTitle(spec.title);
  if (spec.description) embed.setDescription(spec.description);
  if (spec.url) embed.setURL(spec.url);
  if (spec.color !== undefined && spec.color !== null) embed.setColor(parseColour(spec.color));
  if (spec.author?.name) embed.setAuthor({ name: spec.author.name, iconURL: spec.author.iconURL || undefined, url: spec.author.url || undefined });
  if (spec.footer?.text) embed.setFooter({ text: spec.footer.text, iconURL: spec.footer.iconURL || undefined });
  if (spec.thumbnail) embed.setThumbnail(spec.thumbnail);
  if (spec.image) embed.setImage(spec.image);
  if (spec.fields?.length) embed.addFields(spec.fields.map((f) => ({ name: f.name, value: f.value, inline: Boolean(f.inline) })));
  if (spec.timestamp) embed.setTimestamp(spec.timestamp === true ? new Date() : new Date(spec.timestamp));
  return { embed, errors: [] };
}
