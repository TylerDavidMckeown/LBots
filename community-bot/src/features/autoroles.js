import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, SlashCommandBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { getServices } from '../services/index.js';
import { assignableProblem } from '../services/roles.js';
import { assertCanPost, cid, EPHEMERAL, rowsOf } from './common.js';

/** Buttons for small role sets; a dropdown beyond this. */
export const BUTTON_LIMIT = 10;
const EMOJI_PATTERN = /^(<a?:\w{2,32}:\d{17,20}>|(\p{Extended_Pictographic}|\p{Regional_Indicator})[️‍\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]*)$/u;

export function isValidEmoji(text) {
  return EMOJI_PATTERN.test(String(text ?? '').trim());
}

export function panelPayload(ctx, guildId, roles, { title, description } = {}) {
  const kit = ctx.embeds.for(guildId);
  const useButtons = roles.length <= BUTTON_LIMIT;
  const lines = roles.map((r) => `${r.emoji ? `${r.emoji} ` : ''}<@&${r.role_id}>${r.description ? ` — ${r.description}` : ''}`);
  const intro = description || (useButtons ? 'Click a button to add or remove a role.' : 'Pick roles from the menu to add or remove them.');
  const embed = kit.base({ title: title || '🎭 Choose your roles', description: truncate(`${intro}\n\n${lines.join('\n') || '*No roles are available yet.*'}`, 4096) });

  let components = [];
  if (roles.length && useButtons) {
    const buttons = roles.map((r) => {
      const button = new ButtonBuilder().setCustomId(cid('autorole', 'toggle', r.role_id)).setLabel(truncate(r.label, 80)).setStyle(ButtonStyle.Secondary);
      if (r.emoji) button.setEmoji(r.emoji);
      return button;
    });
    components = rowsOf(buttons).map((row) => new ActionRowBuilder().addComponents(row));
  } else if (roles.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(cid('autorole', 'select'))
      .setPlaceholder('Add or remove roles')
      .setMinValues(1)
      .setMaxValues(roles.length)
      .addOptions(roles.map((r) => ({
        label: truncate(r.label, 100), value: r.role_id, description: r.description ? truncate(r.description, 100) : undefined, emoji: r.emoji || undefined,
      })));
    components = [new ActionRowBuilder().addComponents(menu)];
  }
  return { embeds: [embed], components };
}

/** Re-renders every posted panel after the role list changes. Deleted panels are forgotten. */
async function refreshPanels(ctx, guild) {
  const { autoroles } = getServices(ctx);
  const roles = autoroles.list(guild.id);
  for (const panel of autoroles.panels(guild.id)) {
    const channel = await ctx.client.channels.fetch(panel.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(panel.message_id).catch(() => null);
    if (!message) {
      autoroles.removePanel(panel.message_id);
      continue;
    }
    await message.edit(panelPayload(ctx, guild.id, roles, panel)).catch((error) => ctx.logger.warn('Could not refresh role panel', { error: error.message }));
  }
}

/** Toggles each requested role for the clicking member, re-checking every role against the database. */
async function toggleRoles(ctx, interaction, roleIds) {
  const { autoroles } = getServices(ctx);
  const { guild, member } = interaction;
  const added = [];
  const removed = [];
  const problems = [];
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!autoroles.get(guild.id, roleId) || !role) {
      problems.push(`<@&${roleId}> is no longer self-assignable.`);
      continue;
    }
    const problem = await assignableProblem(ctx, guild, role);
    if (problem) {
      problems.push(problem);
      continue;
    }
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(role, 'Self-assigned role panel');
      removed.push(role);
    } else {
      await member.roles.add(role, 'Self-assigned role panel');
      added.push(role);
    }
  }
  const kit = ctx.embeds.for(guild.id);
  const lines = [
    added.length ? `Added: ${added.join(' ')}` : null,
    removed.length ? `Removed: ${removed.join(' ')}` : null,
    ...problems,
  ].filter(Boolean);
  const embed = added.length || removed.length ? kit.success('Roles updated', lines.join('\n')) : kit.warning('No roles changed', lines.join('\n') || 'Nothing changed.');
  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

const command = {
  data: new SlashCommandBuilder().setName('autorole').setDescription('Self-assignable roles')
    .addSubcommand((s) => s.setName('add').setDescription('Make a role self-assignable')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
      .addStringOption((o) => o.setName('label').setDescription('Button label (defaults to the role name)').setMaxLength(80))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji shown on the button').setMaxLength(64))
      .addStringOption((o) => o.setName('description').setDescription('Short description').setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop a role being self-assignable')
      .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List self-assignable roles'))
    .addSubcommand((s) => s.setName('post').setDescription('Post a role panel')
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post (defaults to here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('title').setDescription('Panel title').setMaxLength(256))
      .addStringOption((o) => o.setName('description').setDescription('Panel text').setMaxLength(1000))),
  category: 'Community',
  tier: 'admin',
  async execute(interaction, ctx) {
    const { autoroles } = getServices(ctx);
    const { guild } = interaction;
    const kit = ctx.embeds.for(guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const roles = autoroles.list(guild.id);
      const lines = roles.map((r) => `${r.emoji ? `${r.emoji} ` : ''}<@&${r.role_id}> · **${r.label}**`);
      return interaction.reply({ embeds: [kit.base({ title: '🎭 Self-assignable roles', description: lines.join('\n') || 'None yet. Add one with `/autorole add`.' })], flags: EPHEMERAL });
    }

    if (sub === 'post') {
      const option = interaction.options.getChannel('channel');
      const channel = await assertCanPost(option ? guild.channels.cache.get(option.id) : interaction.channel);
      const roles = autoroles.list(guild.id);
      if (!roles.length) throw new UserError('Add a role with `/autorole add` first.', { title: 'No roles yet' });
      const text = { title: interaction.options.getString('title'), description: interaction.options.getString('description') };
      const message = await channel.send(panelPayload(ctx, guild.id, roles, text));
      autoroles.addPanel({ messageId: message.id, guildId: guild.id, channelId: channel.id, ...text, createdBy: interaction.user.id });
      return interaction.reply({ embeds: [kit.success('Panel posted', `The role panel is live in ${channel}. [Jump to it](${message.url})`)], flags: EPHEMERAL });
    }

    const role = interaction.options.getRole('role', true);
    await interaction.deferReply({ flags: EPHEMERAL });
    if (sub === 'remove') {
      if (!autoroles.remove(guild.id, role.id)) throw new UserError(`${role} is not self-assignable.`, { title: 'Not found' });
      await refreshPanels(ctx, guild);
      return interaction.editReply({ embeds: [kit.success('Role removed', `${role} is no longer self-assignable. Posted panels were updated.`)] });
    }

    const problem = await assignableProblem(ctx, guild, guild.roles.cache.get(role.id) ?? role);
    if (problem) throw new UserError(problem, { title: 'Role not allowed' });
    const emoji = interaction.options.getString('emoji')?.trim() || null;
    if (emoji && !isValidEmoji(emoji)) throw new UserError('Use a single emoji, such as 🎮 or a custom server emoji.', { title: 'Invalid emoji' });
    const { updated } = autoroles.add({
      guildId: guild.id, roleId: role.id, label: interaction.options.getString('label') || role.name, emoji,
      description: interaction.options.getString('description'), addedBy: interaction.user.id,
    });
    await refreshPanels(ctx, guild);
    return interaction.editReply({ embeds: [kit.success(updated ? 'Role updated' : 'Role added', `${role} is self-assignable. Post a panel with \`/autorole post\`.`)] });
  },
};

export default {
  commands: [command],
  components: [
    {
      id: 'autorole:toggle',
      async execute(interaction, ctx, [roleId]) {
        return toggleRoles(ctx, interaction, [roleId]);
      },
    },
    {
      id: 'autorole:select',
      async execute(interaction, ctx) {
        return toggleRoles(ctx, interaction, interaction.values);
      },
    },
  ],
};
