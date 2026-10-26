import { MessageFlags, OverwriteType, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { requireHandler, requireTicketInChannel } from '../services/access.js';
import { getServices } from '../services/index.js';
import { logTicketEvent } from '../services/ticketActions.js';
import {
  claim, closeAndConfirm, promptDelete, reopenAndConfirm, unclaim,
} from '../services/ticketInteractions.js';

const MEMBER_ALLOW = { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true };

async function addMember(interaction, ctx) {
  const { tickets } = getServices(ctx);
  const ticket = requireTicketInChannel(ctx, interaction, { statuses: ['open'] });
  requireHandler(ctx, interaction, ticket.type);
  const user = interaction.options.getUser('user', true);
  if (user.bot) throw new UserError('Bots cannot be added to tickets.', { title: 'Invalid member' });
  if (user.id === ticket.opener_id) throw new UserError('That member opened this ticket and already has access.', { title: 'Already added' });
  if (!await interaction.guild.members.fetch(user.id).catch(() => null)) throw new UserError('That user is not in this server.', { title: 'Invalid member' });

  await interaction.channel.permissionOverwrites.edit(user.id, MEMBER_ALLOW, { type: OverwriteType.Member, reason: `Added to ticket by ${interaction.user.tag}` });
  tickets.addMember(ticket.id, user.id, interaction.user.id);
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.reply({
    embeds: [kit.success('Member added', `${user} was added to this ticket by ${interaction.user}.`)],
    allowedMentions: { users: [user.id] },
  });
  await logTicketEvent(ctx, ticket, 'member_added', interaction.user.id, { Member: `<@${user.id}>` });
}

async function removeMember(interaction, ctx) {
  const { tickets } = getServices(ctx);
  const ticket = requireTicketInChannel(ctx, interaction);
  requireHandler(ctx, interaction, ticket.type);
  const user = interaction.options.getUser('user', true);
  if (user.id === ticket.opener_id) throw new UserError('The person who opened the ticket cannot be removed.', { title: 'Cannot remove' });
  const wasMember = tickets.removeMember(ticket.id, user.id);
  const overwrite = interaction.channel.permissionOverwrites.cache.get(user.id);
  if (!wasMember && !overwrite) throw new UserError(`${user} was not added to this ticket.`, { title: 'Not a member' });
  await overwrite?.delete(`Removed from ticket by ${interaction.user.tag}`);
  const kit = ctx.embeds.for(interaction.guildId);
  await interaction.reply({ embeds: [kit.success('Member removed', `${user} was removed from this ticket.`)] });
  await logTicketEvent(ctx, ticket, 'member_removed', interaction.user.id, { Member: `<@${user.id}>` });
}

async function blacklist(interaction, ctx, action) {
  const { tickets } = getServices(ctx);
  const kit = ctx.embeds.for(interaction.guildId);
  if (action === 'list') {
    const entries = tickets.listBlacklist(interaction.guildId);
    const lines = entries.map((e) => `<@${e.user_id}> · ${discordTimestamp(e.created_at, 'd')}${e.reason ? ` · ${truncate(e.reason, 80)}` : ''}`);
    return interaction.reply({
      embeds: [kit.base({ title: '🚫 Ticket blacklist', description: lines.length ? truncate(lines.join('\n'), 4000) : 'Nobody is blacklisted.' })],
      flags: MessageFlags.Ephemeral,
    });
  }
  const user = interaction.options.getUser('user', true);
  if (action === 'add') {
    if (user.id === interaction.user.id) throw new UserError('You cannot blacklist yourself.', { title: 'Invalid member' });
    if (user.bot) throw new UserError('Bots cannot open tickets anyway.', { title: 'Invalid member' });
    const reason = interaction.options.getString('reason');
    tickets.blacklist(interaction.guildId, user.id, reason, interaction.user.id);
    ctx.logger.info('Ticket blacklist add', { guildId: interaction.guildId, userId: user.id, by: interaction.user.id });
    return interaction.reply({ embeds: [kit.success('Blacklisted', `${user} can no longer open tickets.${reason ? `\n**Reason:** ${reason}` : ''}`)], flags: MessageFlags.Ephemeral });
  }
  if (!tickets.unblacklist(interaction.guildId, user.id)) throw new UserError(`${user} is not blacklisted.`, { title: 'Not blacklisted' });
  ctx.logger.info('Ticket blacklist remove', { guildId: interaction.guildId, userId: user.id, by: interaction.user.id });
  return interaction.reply({ embeds: [kit.success('Removed from blacklist', `${user} can open tickets again.`)], flags: MessageFlags.Ephemeral });
}

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage tickets')
    .addSubcommand((s) => s.setName('add').setDescription('Add a member to this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Member to add').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a member from this ticket')
      .addUserOption((o) => o.setName('user').setDescription('Member to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim this ticket'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Release your claim on this ticket'))
    .addSubcommand((s) => s.setName('close').setDescription('Close this ticket')
      .addStringOption((o) => o.setName('reason').setDescription('Why the ticket is being closed').setMaxLength(500)))
    .addSubcommand((s) => s.setName('reopen').setDescription('Reopen this closed ticket'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete this closed ticket now'))
    .addSubcommandGroup((g) => g.setName('blacklist').setDescription('Stop members from opening tickets')
      .addSubcommand((s) => s.setName('add').setDescription('Blacklist a member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason (shown to the member)').setMaxLength(300)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a member from the blacklist')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('List blacklisted members'))),
  category: 'Tickets',
  tier: 'member',
  subcommandTiers: {
    'blacklist add': 'moderator',
    'blacklist remove': 'moderator',
    'blacklist list': 'moderator',
  },
  async execute(interaction, ctx) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (group === 'blacklist') return blacklist(interaction, ctx, sub);

    switch (sub) {
      case 'add': return addMember(interaction, ctx);
      case 'remove': return removeMember(interaction, ctx);
      case 'claim': return claim(ctx, interaction, requireTicketInChannel(ctx, interaction));
      case 'unclaim': return unclaim(ctx, interaction, requireTicketInChannel(ctx, interaction));
      case 'close': return closeAndConfirm(ctx, interaction, requireTicketInChannel(ctx, interaction), interaction.options.getString('reason'));
      case 'reopen': return reopenAndConfirm(ctx, interaction, requireTicketInChannel(ctx, interaction));
      case 'delete': return promptDelete(ctx, interaction, requireTicketInChannel(ctx, interaction));
      default: throw new Error(`Unhandled /ticket subcommand ${sub}`);
    }
  },
};
