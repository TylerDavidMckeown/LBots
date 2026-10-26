import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { makeCustomId } from '@lyss/shared/router.js';
import { getServices } from './index.js';
import { ticketType } from './ticketTypes.js';

const statements = new WeakMap();
function q(db) {
  let s = statements.get(db);
  if (!s) {
    s = {
      get: db.prepare('SELECT * FROM panels WHERE guild_id = ? AND type = ?'),
      upsert: db.prepare(`
        INSERT INTO panels (guild_id, type, channel_id, message_id, title, description, button_label, updated_by, updated_at)
        VALUES (@guildId, @type, @channelId, @messageId, @title, @description, @buttonLabel, @userId, @now)
        ON CONFLICT (guild_id, type) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id,
          title = excluded.title, description = excluded.description, button_label = excluded.button_label,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `),
    };
    statements.set(db, s);
  }
  return s;
}

export function commissionAvailability(ctx, guildId) {
  const open = ctx.guildConfig.get(guildId, 'commissions.open');
  const slots = ctx.guildConfig.get(guildId, 'commissions.slots');
  const active = getServices(ctx).commissions.activeCount(guildId);
  const free = Math.max(0, slots - active);
  return { open, slots, active, free, accepting: open && free > 0 };
}

export function assertCommissionsAvailable(ctx, guildId) {
  const availability = commissionAvailability(ctx, guildId);
  if (!availability.open) throw new UserError('Commissions are closed right now. Please check back later!', { title: 'Commissions closed' });
  if (!availability.free) throw new UserError('All commission slots are taken right now. Please check back soon!', { title: 'No slots available' });
  return availability;
}

export function getPanel(ctx, guildId, typeKey) {
  return q(ctx.db).get.get(guildId, typeKey);
}

/** Panel embed and button. The commission panel shows a live slot counter. */
export function buildPanel(ctx, guildId, typeKey, overrides = {}) {
  const type = ticketType(typeKey);
  const kit = ctx.embeds.for(guildId);
  const embed = kit.base({ title: overrides.title || type.panel.title, description: overrides.description || type.panel.description });
  let disabled = false;
  if (typeKey === 'commissions') {
    const a = commissionAvailability(ctx, guildId);
    const status = !a.open ? '🔴 Closed' : a.free ? `🟢 Open, ${a.free} of ${a.slots} slot${a.slots === 1 ? '' : 's'} free` : `🟠 All ${a.slots} slots taken`;
    embed.addFields({ name: 'Availability', value: status });
    disabled = !a.accepting;
  }
  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId('tickets', 'ticket', 'open', typeKey))
      .setLabel(overrides.button_label || type.panel.button)
      .setEmoji(type.emoji)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
  return { embeds: [embed], components: [buttonRow] };
}

export async function postPanel(ctx, channel, typeKey, { title = null, description = null, buttonLabel = null }, userId) {
  const message = await channel.send(buildPanel(ctx, channel.guildId, typeKey, { title, description, button_label: buttonLabel }));
  q(ctx.db).upsert.run({
    guildId: channel.guildId, type: typeKey, channelId: channel.id, messageId: message.id, title, description, buttonLabel, userId, now: Date.now(),
  });
  return message;
}

/** Saves new panel text and edits the posted message. */
export async function editPanel(ctx, guildId, typeKey, changes, userId) {
  const panel = getPanel(ctx, guildId, typeKey);
  if (!panel) throw new UserError(`No ${ticketType(typeKey).label.toLowerCase()} panel has been posted yet. Post one with /panel first.`, { title: 'No panel' });
  const next = {
    title: changes.title ?? panel.title,
    description: changes.description ?? panel.description,
    buttonLabel: changes.buttonLabel ?? panel.button_label,
  };
  q(ctx.db).upsert.run({ guildId, type: typeKey, channelId: panel.channel_id, messageId: panel.message_id, ...next, userId, now: Date.now() });
  return refreshPanel(ctx, guildId, typeKey);
}

/** Re-renders the stored panel message. Returns false if it was deleted. */
export async function refreshPanel(ctx, guildId, typeKey) {
  const panel = getPanel(ctx, guildId, typeKey);
  if (!panel) return false;
  try {
    const channel = await ctx.client.channels.fetch(panel.channel_id);
    const message = await channel.messages.fetch(panel.message_id);
    await message.edit(buildPanel(ctx, guildId, typeKey, panel));
    return true;
  } catch (error) {
    ctx.logger.warn('Could not refresh ticket panel', { guildId, type: typeKey, error: error.message });
    return false;
  }
}
