/**
 * Game engine protocol. Each game is a pure state machine, run by gameService:
 *
 *   start({ stake, options, rng, now, timeLimitMs }) → state
 *   act(state, action, { rng, now, input, actor }) → step
 *   expire(state, { rng, now }) → step with an outcome, or null to refund every stake
 *
 * `act` and `expire` receive a private copy of the state and may change it.
 * A step is { state, feedback?, invalid?, done?, outcome?, hold? }:
 * - invalid: the action was rejected and nothing changes,
 * - hold: an extra stake to take from the acting player (blackjack double down),
 * - outcome (solo): { result: 'win' | 'loss' | 'push', payout, xp?, gameXp? }, where payout is the
 *   total returned (stake included) or, for free games, the base coin reward,
 * - outcome (duel): { winner: 'host' | 'opponent' | null }.
 */

export const invalid = (state, feedback) => ({ state, feedback, invalid: true });
export const next = (state, feedback = null) => ({ state, feedback });
export const finish = (state, outcome, feedback = null) => ({ state, feedback, done: true, outcome });

/** Outcome for a staked game: compares the payout with the stake. */
export const staked = (stake, payout, extra = {}) => ({
  result: payout > stake ? 'win' : payout === stake ? 'push' : 'loss', payout, ...extra,
});

/** Outcome for a free game. Coins are only paid on a win; XP is whatever the game grants. */
export const free = (won, coins = 0, xp = 0, extra = {}) => ({ result: won ? 'win' : 'loss', payout: won ? coins : 0, xp, ...extra });

/** Parses actions such as "flip:3" into an index below `max`, or null. */
export function indexFrom(action, prefix, max) {
  const match = new RegExp(`^${prefix}:(\\d{1,2})$`).exec(action ?? '');
  const index = match ? Number(match[1]) : -1;
  return index >= 0 && index < max ? index : null;
}

/** Parses a typed whole number (commas and spaces allowed), or null. */
export function wholeNumber(input) {
  const text = String(input ?? '').trim().replace(/[,\s]/g, '');
  return /^-?\d{1,9}$/.test(text) ? Number(text) : null;
}
