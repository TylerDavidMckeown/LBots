import { ActivityType } from 'discord.js';

const MIN_INTERVAL_MS = 30_000;

export function renderStatusText(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * Rotates the bot's presence through `entries` at a conservative interval.
 * Entry shape: { type: 'Playing' | 'Watching' | 'Listening' | 'Competing' | 'Custom', text: string, status?: string }
 * Text may use {guilds}, {members} and {version}.
 */
export function createStatusRotator({ client, entries, intervalMs = 45_000, version = '', logger }) {
  let timer = null;
  let index = 0;

  const vars = () => ({
    guilds: client.guilds.cache.size,
    members: client.guilds.cache.reduce((sum, guild) => sum + (guild.memberCount ?? 0), 0),
    version,
  });

  function apply() {
    if (!entries?.length || !client.user) return;
    const entry = entries[index % entries.length];
    index += 1;
    const text = renderStatusText(entry.text, vars());
    const type = ActivityType[entry.type] ?? ActivityType.Custom;
    const activity = type === ActivityType.Custom ? { name: 'custom', state: text, type } : { name: text, type };
    try {
      client.user.setPresence({ activities: [activity], status: entry.status ?? 'online' });
    } catch (error) {
      logger?.warn('Failed to update presence', { error: error.message });
    }
  }

  return {
    start() {
      if (timer || !entries?.length) return;
      apply();
      if (entries.length > 1) {
        timer = setInterval(apply, Math.max(intervalMs, MIN_INTERVAL_MS));
        timer.unref?.();
      }
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
