/**
 * Activity hub. Services report what a member did (finished a job, won a puzzle, fed a pet)
 * and listeners react synchronously, inside the reporting service's transaction: if a
 * listener fails, the whole operation rolls back. Member progression listens today;
 * quests and achievements can subscribe to the same stream later.
 *
 * An activity is { guildId, userId, activity, variant?, operationKey, now, settings }.
 * The operationKey identifies the action, so listeners can ignore repeats.
 */
export function createActivityHub() {
  const listeners = new Map();
  return {
    on(name, listener) {
      if (listeners.has(name)) throw new Error(`Duplicate activity listener ${name}`);
      listeners.set(name, listener);
    },
    /** Runs every listener and returns their results by name, e.g. { progression: {...} }. */
    emit(event) {
      if (!event.operationKey) throw new Error(`Activity ${event.activity} needs an operation key`);
      return Object.fromEntries([...listeners].map(([name, listener]) => [name, listener(event)]));
    },
  };
}

/** For services used on their own (tests): reporting an activity does nothing. */
export const NO_ACTIVITY = Object.freeze({ on() {}, emit: () => ({}) });
