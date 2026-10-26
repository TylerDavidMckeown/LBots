import { ActionRowBuilder, ApplicationCommandOptionType, MessageFlags, SlashCommandBuilder, StringSelectMenuBuilder } from 'discord.js';
import { hasTier } from './permissions.js';
import { makeCustomId } from './router.js';
import { plural, truncate } from './utils/text.js';

/**
 * Lists the command lines a member at `tier` may use, e.g. "`/setup view` — Show the current configuration".
 */
export function visibleCommandLines(command, tier) {
  if (!hasTier(tier, command.tier ?? 'member')) return [];
  const json = command.data.toJSON();
  const subTier = (key) => command.subcommandTiers?.[key] ?? command.tier ?? 'member';
  const lines = [];
  let hasSubcommands = false;
  for (const option of json.options ?? []) {
    if (option.type === ApplicationCommandOptionType.Subcommand) {
      hasSubcommands = true;
      if (hasTier(tier, subTier(option.name))) lines.push(`\`/${json.name} ${option.name}\` — ${option.description}`);
    } else if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      hasSubcommands = true;
      for (const sub of option.options ?? []) {
        const key = `${option.name} ${sub.name}`;
        if (hasTier(tier, subTier(key))) lines.push(`\`/${json.name} ${key}\` — ${sub.description}`);
      }
    }
  }
  if (!hasSubcommands) lines.push(`\`/${json.name}\` — ${json.description}`);
  return lines;
}

/** Groups the commands visible to `tier` by category. */
export function visibleCategories(commands, tier) {
  const categories = new Map();
  for (const command of commands.values()) {
    if (command.hidden) continue;
    const lines = visibleCommandLines(command, tier);
    if (!lines.length) continue;
    const name = command.category ?? 'General';
    if (!categories.has(name)) categories.set(name, []);
    categories.get(name).push(...lines);
  }
  return new Map([...categories].sort(([a], [b]) => a.localeCompare(b)));
}

function menuRow(config, categories, selected) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(makeCustomId(config.namespace, 'help', 'category'))
    .setPlaceholder('Choose a category')
    .addOptions([...categories.keys()].slice(0, 25).map((name) => ({
      label: truncate(name, 100),
      value: truncate(name, 100),
      description: plural(categories.get(name).length, 'command'),
      default: name === selected,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

export function createHelpCommand(config) {
  const intro = config.help.intro ?? `Here is everything ${config.name} can do for you. Choose a category below.`;

  const command = {
    data: new SlashCommandBuilder().setName('help').setDescription(`Show ${config.name} commands`),
    category: 'General',
    tier: 'restricted',
    cooldown: 3,
    async execute(interaction, ctx) {
      const tier = ctx.permissions.tierOf(interaction);
      const categories = visibleCategories(ctx.commands, tier);
      const kit = ctx.embeds.for(interaction.guildId);
      const embed = kit.base({ title: `${config.name} help`, description: intro })
        .addFields([...categories].slice(0, 25).map(([name, lines]) => ({
          name,
          value: plural(lines.length, 'command'),
          inline: true,
        })));
      const components = categories.size ? [menuRow(config, categories)] : [];
      return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
    },
  };

  const categorySelect = {
    id: 'help:category',
    tier: 'restricted',
    async execute(interaction, ctx) {
      const tier = ctx.permissions.tierOf(interaction);
      const categories = visibleCategories(ctx.commands, tier);
      const selected = interaction.values[0];
      const lines = categories.get(selected);
      const kit = ctx.embeds.for(interaction.guildId);
      if (!lines) {
        return interaction.update({ embeds: [kit.warning('Category unavailable', 'That category is not available to you.')], components: [menuRow(config, categories)] });
      }
      const embed = kit.base({ title: `${config.name} help › ${selected}`, description: truncate(lines.join('\n'), 4096) });
      return interaction.update({ embeds: [embed], components: [menuRow(config, categories, selected)] });
    },
  };

  return { command, components: [categorySelect] };
}
