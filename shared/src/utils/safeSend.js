import { MessageFlags } from 'discord.js';
import { truncate } from './text.js';
import { MESSAGE_LIMITS } from '../embedBuilder/validators.js';

const NO_MENTIONS = Object.freeze({ parse: [] });

function normalise(payload) {
  const body = typeof payload === 'string' ? { content: payload } : { ...payload };
  if (body.content) body.content = truncate(body.content, MESSAGE_LIMITS.content);
  body.allowedMentions ??= NO_MENTIONS;
  return body;
}

/**
 * Replies to an interaction regardless of whether it was already deferred or answered.
 */
export async function respond(interaction, payload, { ephemeral = false } = {}) {
  const body = normalise(payload);
  if (ephemeral) body.flags = (body.flags ?? 0) | MessageFlags.Ephemeral;
  if (interaction.deferred && !interaction.replied) {
    const { flags, ...edit } = body;
    return interaction.editReply(edit);
  }
  if (interaction.replied) return interaction.followUp(body);
  return interaction.reply(body);
}

/**
 * Sends to a channel without pinging anyone by default. Returns null instead of
 * throwing when the bot lacks access, so callers can degrade gracefully.
 */
export async function safeSend(channel, payload, { logger } = {}) {
  if (!channel?.isTextBased?.()) return null;
  try {
    return await channel.send(normalise(payload));
  } catch (error) {
    logger?.warn('Failed to send message', { channelId: channel.id, error: error.message, code: error.code });
    return null;
  }
}
