import { getServices } from '../services/index.js';

/** Finished work and game sessions are kept this long. Results and statistics are kept permanently. */
const SESSION_RETENTION = 7 * 24 * 60 * 60_000;

/** Hourly cleanup of expired confirmations, embed drafts and old work and game sessions. */
export default {
  jobs: [
    {
      type: 'community:cleanup',
      every: 60 * 60_000,
      async execute(payload, task, ctx) {
        const { economy, embeds, jobs, games, petBattles } = getServices(ctx);
        const before = Date.now() - SESSION_RETENTION;
        const pending = economy.prunePending();
        const drafts = embeds.pruneDrafts();
        const expiredJobs = jobs.expireStale();
        const prunedJobs = jobs.prune(before);
        const prunedGames = games.prune(before);
        const prunedBattles = petBattles.prune(before);
        if (pending || drafts || expiredJobs || prunedJobs || prunedGames || prunedBattles) {
          ctx.logger.info('Community cleanup', { pending, drafts, expiredJobs, prunedJobs, prunedGames, prunedBattles });
        }
      },
    },
  ],
};
