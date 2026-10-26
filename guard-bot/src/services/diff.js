import { PermissionsBitField } from 'discord.js';

/** Human-readable differences between two channel snapshots. Pure for testing. */
export function diffChannel(before, after) {
  const changes = [];
  if (before.name !== after.name) changes.push(`Name: \`${before.name}\` → \`${after.name}\``);
  if ((before.topic ?? '') !== (after.topic ?? '')) changes.push('Topic changed');
  if (Boolean(before.nsfw) !== Boolean(after.nsfw)) changes.push(`Age-restricted: ${after.nsfw ? 'on' : 'off'}`);
  if ((before.rateLimitPerUser ?? 0) !== (after.rateLimitPerUser ?? 0)) changes.push(`Slowmode: ${before.rateLimitPerUser ?? 0}s → ${after.rateLimitPerUser ?? 0}s`);
  if ((before.parentId ?? null) !== (after.parentId ?? null)) changes.push(`Category: ${before.parentId ? `<#${before.parentId}>` : 'none'} → ${after.parentId ? `<#${after.parentId}>` : 'none'}`);
  if (overwriteSignature(before) !== overwriteSignature(after)) changes.push('Permissions changed');
  return changes;
}

function overwriteSignature(channel) {
  const overwrites = channel.permissionOverwrites?.cache ?? channel.permissionOverwrites ?? new Map();
  return [...overwrites.values()]
    .map((o) => `${o.id}:${o.allow?.bitfield ?? o.allow}:${o.deny?.bitfield ?? o.deny}`)
    .sort()
    .join('|');
}

/** Human-readable differences between two role snapshots. Pure for testing. */
export function diffRole(before, after) {
  const changes = [];
  if (before.name !== after.name) changes.push(`Name: \`${before.name}\` → \`${after.name}\``);
  if (before.color !== after.color) {
    const hex = (c) => `#${Number(c).toString(16).padStart(6, '0').toUpperCase()}`;
    changes.push(`Colour: ${hex(before.color)} → ${hex(after.color)}`);
  }
  if (Boolean(before.hoist) !== Boolean(after.hoist)) changes.push(`Shown separately: ${after.hoist ? 'yes' : 'no'}`);
  if (Boolean(before.mentionable) !== Boolean(after.mentionable)) changes.push(`Mentionable: ${after.mentionable ? 'yes' : 'no'}`);
  const oldPerms = new PermissionsBitField(before.permissions).toArray();
  const newPerms = new PermissionsBitField(after.permissions).toArray();
  const added = newPerms.filter((p) => !oldPerms.includes(p));
  const removed = oldPerms.filter((p) => !newPerms.includes(p));
  if (added.length) changes.push(`Permissions added: ${added.join(', ')}`);
  if (removed.length) changes.push(`Permissions removed: ${removed.join(', ')}`);
  return changes;
}
