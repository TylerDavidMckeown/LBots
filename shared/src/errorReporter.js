import crypto from 'node:crypto';
import { redact } from './redact.js';
import { truncate, codeBlock } from './utils/text.js';
import { safeSend } from './utils/safeSend.js';

/**
 * An expected, user-facing failure (bad input, missing permission, insufficient funds).
 * The router shows its message directly and does not record it as an error.
 */
export class UserError extends Error {
  constructor(message, { title = 'That did not work' } = {}) {
    super(message);
    this.name = 'UserError';
    this.title = title;
  }
}

export function makeErrorId() {
  return `LYS-${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5)}`;
}

const CHANNEL_POSTS_PER_MINUTE = 10;

/**
 * Records errors in the database, the local log and the configured error-log channel.
 * Always returns a reference ID that is safe to show to users.
 */
export function createErrorReporter({ botName, db, logger, client, guildConfig, embeds, defaultGuildId }) {
  const insert = db.prepare(`
    INSERT INTO error_log (id, bot, source, guild_id, channel_id, user_id, message, stack, created_at)
    VALUES (@id, @bot, @source, @guildId, @channelId, @userId, @message, @stack, @createdAt)
  `);
  let windowStart = 0;
  let postsInWindow = 0;

  function allowChannelPost() {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      postsInWindow = 0;
    }
    postsInWindow += 1;
    return postsInWindow <= CHANNEL_POSTS_PER_MINUTE;
  }

  async function postToChannel(record) {
    const guildId = record.guildId ?? defaultGuildId;
    const channelId = guildId ? guildConfig?.get(guildId, 'channel.errorLog') : null;
    if (!channelId || !client?.isReady?.() || !allowChannelPost()) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const kit = embeds.for(guildId);
    const embed = kit.error(`Error ${record.id}`, codeBlock(truncate(record.message, 1500)))
      .addFields(
        { name: 'Source', value: truncate(record.source, 1024), inline: true },
        { name: 'User', value: record.userId ? `<@${record.userId}>` : 'n/a', inline: true },
        { name: 'Channel', value: record.channelId ? `<#${record.channelId}>` : 'n/a', inline: true },
      );
    await safeSend(channel, { embeds: [embed] }, { logger });
  }

  return {
    /**
     * @param {unknown} error
     * @param {{ source: string, guildId?: string, channelId?: string, userId?: string }} context
     * @returns {Promise<string>} Reference ID.
     */
    async report(error, context = {}) {
      const record = {
        id: makeErrorId(),
        bot: botName,
        source: context.source ?? 'unknown',
        guildId: context.guildId ?? null,
        channelId: context.channelId ?? null,
        userId: context.userId ?? null,
        message: truncate(redact(error?.message ?? String(error)), 2000),
        stack: error?.stack ? truncate(redact(error.stack), 8000) : null,
        createdAt: Date.now(),
      };
      try {
        insert.run(record);
      } catch (dbError) {
        logger.error('Could not write error_log row', { error: dbError.message });
      }
      logger.error(record.message, { ref: record.id, source: record.source, guildId: record.guildId, userId: record.userId, stack: record.stack });
      try {
        await postToChannel(record);
      } catch (postError) {
        logger.warn('Could not post error to Discord', { ref: record.id, error: postError.message });
      }
      return record.id;
    },
  };
}
