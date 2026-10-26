import { getServices } from '../services/index.js';

const OFFENCE_RETENTION_MS = 7 * 86_400_000;

/** Prunes cached message content past each guild's retention period, and old anti-spam offences. */
export default {
  type: 'guard:cleanup',
  every: 60 * 60_000,
  async execute(payload, task, ctx) {
    const { messages, antispam } = getServices(ctx);
    const now = Date.now();
    let removed = 0;
    for (const guildId of ctx.client.guilds.cache.keys()) {
      removed += messages.prune(guildId, now - ctx.guildConfig.get(guildId, 'logs.messageCacheRetention'));
    }
    const offences = antispam.prune(now - OFFENCE_RETENTION_MS);
    if (removed || offences) ctx.logger.info('Guard cleanup', { messagesRemoved: removed, offencesRemoved: offences });
  },
};
