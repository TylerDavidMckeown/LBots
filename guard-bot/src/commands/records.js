import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { Tier } from '@lyss/shared/permissions.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { caseEmbed, historyPage } from '../embeds/caseEmbeds.js';
import { getServices } from '../services/index.js';

const caseNumber = (o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1);

export default [
  {
    data: new SlashCommandBuilder().setName('note').setDescription('Private staff notes about a member')
      .addSubcommand((s) => s.setName('add').setDescription('Add a note')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addStringOption((o) => o.setName('content').setDescription('The note').setRequired(true).setMaxLength(1000)))
      .addSubcommand((s) => s.setName('list').setDescription('List notes for a member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a note')
        .addIntegerOption((o) => o.setName('id').setDescription('Note ID').setRequired(true).setMinValue(1))),
    category: 'Records',
    tier: 'moderator',
    async execute(interaction, ctx) {
      const { cases } = getServices(ctx);
      const kit = ctx.embeds.for(interaction.guildId);
      const sub = interaction.options.getSubcommand();
      if (sub === 'add') {
        const user = interaction.options.getUser('user', true);
        const note = cases.addNote(interaction.guildId, user.id, interaction.user.id, interaction.options.getString('content', true));
        return interaction.reply({ embeds: [kit.success('Note added', `Note #${note.id} saved for ${user}.`)], flags: MessageFlags.Ephemeral });
      }
      if (sub === 'remove') {
        const id = interaction.options.getInteger('id', true);
        if (!cases.removeNote(interaction.guildId, id)) throw new UserError(`Note #${id} does not exist.`, { title: 'Note not found' });
        return interaction.reply({ embeds: [kit.success('Note removed', `Note #${id} was removed.`)], flags: MessageFlags.Ephemeral });
      }
      const user = interaction.options.getUser('user', true);
      const notes = cases.notes(interaction.guildId, user.id);
      const lines = notes.map((n) => `**#${n.id}** · ${discordTimestamp(n.created_at, 'd')} · <@${n.author_id}>\n> ${truncate(n.content, 300)}`);
      return interaction.reply({
        embeds: [kit.base({ title: `🗒️ Notes · ${user.username}`, description: truncate(lines.join('\n') || 'No notes.', 4096) })],
        flags: MessageFlags.Ephemeral,
      });
    },
  },

  {
    data: new SlashCommandBuilder().setName('history').setDescription('A member\'s moderation history')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    category: 'Records',
    tier: 'moderator',
    async execute(interaction, ctx) {
      const user = interaction.options.getUser('user', true);
      return interaction.reply({ ...historyPage(ctx, interaction.guildId, user.id, 1, getServices(ctx)), flags: MessageFlags.Ephemeral });
    },
  },

  {
    data: new SlashCommandBuilder().setName('case').setDescription('Moderation cases')
      .addSubcommand((s) => s.setName('view').setDescription('View a case').addIntegerOption(caseNumber))
      .addSubcommand((s) => s.setName('reason').setDescription('Update a case reason').addIntegerOption(caseNumber)
        .addStringOption((o) => o.setName('reason').setDescription('New reason').setRequired(true).setMaxLength(500))),
    category: 'Records',
    tier: 'moderator',
    async execute(interaction, ctx) {
      const { cases } = getServices(ctx);
      const number = interaction.options.getInteger('number', true);
      const existing = cases.get(interaction.guildId, number);
      if (!existing) throw new UserError(`Case #${number} does not exist.`, { title: 'Case not found' });

      if (interaction.options.getSubcommand() === 'view') {
        return interaction.reply({ embeds: [caseEmbed(ctx, existing)], flags: MessageFlags.Ephemeral });
      }
      if (existing.moderator_id !== interaction.user.id && ctx.permissions.tierOf(interaction) < Tier.ADMIN) {
        throw new UserError('Only the moderator who created this case, or an admin, can change its reason.', { title: 'Missing permission' });
      }
      const updated = cases.updateReason(interaction.guildId, number, interaction.options.getString('reason', true));
      ctx.logger.info('Case reason updated', { guildId: interaction.guildId, case: number, by: interaction.user.id });
      // Keep the moderation log in sync.
      if (updated.log_channel_id && updated.log_message_id) {
        const channel = await ctx.client.channels.fetch(updated.log_channel_id).catch(() => null);
        const message = await channel?.messages.fetch(updated.log_message_id).catch(() => null);
        await message?.edit({ embeds: [caseEmbed(ctx, updated)] }).catch(() => null);
      }
      const kit = ctx.embeds.for(interaction.guildId);
      return interaction.reply({ embeds: [kit.success('Reason updated', `Case #${number} now reads:\n> ${truncate(updated.reason, 900)}`)], flags: MessageFlags.Ephemeral });
    },
  },
];
