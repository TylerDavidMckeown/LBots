import { getServices } from '../services/index.js';
import { botActor, unban } from '../services/moderation.js';

/** Lifts a temporary ban when it expires. */
export default {
  type: 'guard:unban',
  async execute({ guildId, userId, caseId }, task, ctx) {
    const { cases } = getServices(ctx);
    // A later ban, tempban or manual unban supersedes this one, so never undo a newer decision.
    const latest = cases.latestBanCase(guildId, userId);
    if (!latest || latest.id !== caseId) return;
    const guild = await ctx.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;
    const banned = await guild.bans.fetch({ user: userId, force: true }).catch(() => null);
    if (!banned) return;
    await unban(ctx, guild, botActor(ctx), userId, `Temporary ban (case #${latest.number}) expired`, { source: 'automatic', relatedCaseId: caseId });
  },
};
