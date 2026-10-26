import {
  ActionRowBuilder, ButtonStyle, Events, ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { UserError } from '@lyss/shared/errorReporter.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { formatCoins } from '../services/economyRules.js';
import { getServices, settingsFor } from '../services/index.js';
import { ITEMS, itemLabel, itemList, itemsOfKind } from '../services/items.js';
import { PET_LEADERBOARD_CHOICES } from '../services/petService.js';
import {
  DESTINATIONS, EGGS, SPECIES, STATS, VARIANTS,
} from '../services/pets/catalogue.js';
import {
  CARE, displayName, petLabel, petLevelForXp, stageName,
} from '../services/pets/rules.js';
import { cid, EPHEMERAL, fetchChannel } from './common.js';
import {
  abilitiesEmbed, adoptionCentrePayload, adoptionOfferPayload, battlePayload, button, collectionPayload, cosmeticsPayload,
  evolutionPayload, expeditionPanel, expeditionPayload, hatchOfferPayload, leaderboardPayload, petLevelLines, petOptionLabel,
  profilePayload, statsEmbed,
} from './petViews.js';
import { progressionLines } from './progression.js';

/** /pet: adoption, care, expeditions, evolution, accessories and pet battles. */

const settings = (ctx, guildId) => settingsFor(ctx, guildId);

function assertPetsEnabled(ctx, guildId) {
  if (!settings(ctx, guildId).petsEnabled) throw new UserError('Pets are disabled in this server.', { title: 'Disabled' });
}

const kitFor = (ctx, interaction) => ctx.embeds.for(interaction.guildId);
const base = (interaction) => ({ guildId: interaction.guildId, userId: interaction.user.id });

// ── Care ────────────────────────────────────────────────────────────────

function careFeedback(action, result) {
  const name = displayName(result.pet);
  const xp = result.levels?.xp ? ` · +${result.levels.xp} XP` : '';
  let line;
  switch (action) {
    case 'feed': {
      const food = result.food === 'kibble' ? `${CARE.kibble.emoji} kibble` : itemLabel(result.food);
      const gains = [result.happiness ? `+${result.happiness} happiness` : null, result.energy ? `+${result.energy} energy` : null].filter(Boolean).join(' · ');
      line = `${name} ate the ${food}.${gains ? ` ${gains}` : ''}${xp}`;
      break;
    }
    case 'play':
      line = `🎾 You played with ${name}. +${result.happiness} happiness · −${result.energy} energy${xp}`;
      break;
    case 'train':
      line = `🏋️ ${name} trained ${STATS[result.stat].emoji} ${STATS[result.stat].label} (${result.points}/${result.cap}). −${result.energy} energy${xp}`;
      break;
    case 'explore':
      line = `🧭 ${name} explored and found ${formatCoins(result.coins)}${result.items.length ? ` and ${itemList(result.items)}` : ''}. −${result.energy} energy${xp}`;
      break;
    case 'sleep':
      line = result.woke ? `☀️ ${name} woke up with ${result.pet.energy} energy.` : `💤 ${name} curled up for a nap. Fully rested ${discordTimestamp(result.pet.busy_until, 'R')}.`;
      break;
    default:
      line = '';
  }
  return [line, ...petLevelLines(result.pet, result.levels), ...progressionLines(result.progression)].join('\n');
}

const CARE_ACTIONS = Object.freeze({
  feed: (pets, args) => pets.feed(args),
  play: (pets, args) => pets.play(args),
  explore: (pets, args) => pets.explore(args),
  sleep: (pets, args) => pets.sleep(args),
  train: (pets, args) => pets.train(args),
});

function runCare(ctx, interaction, action, extra = {}) {
  return CARE_ACTIONS[action](getServices(ctx).pets, { ...base(interaction), settings: settings(ctx, interaction.guildId), ...extra });
}

// ── Adoption ────────────────────────────────────────────────────────────

function welcomePayload(ctx, result) {
  const { pet } = result;
  const lines = [
    `🎉 **Welcome home, ${displayName(pet)}!**${result.egg ? ` It hatched from your ${itemLabel(result.egg)}.` : ''}${result.price ? ` Paid ${formatCoins(result.price)}.` : ''}`,
    pet.variant !== 'classic' ? `✨ A rare **${VARIANTS[pet.variant].label}** variant!` : null,
    ...result.milestones.map((m) => `📚 Collection milestone: ${m.species} species discovered! Rewards sent to your bank and inventory.`),
    ...progressionLines(result.progression),
  ].filter(Boolean);
  return profilePayload(ctx, pet, { feedback: lines.join('\n') });
}

// ── Expeditions ─────────────────────────────────────────────────────────

/** Re-renders an expedition's public message, if it has one. */
async function refreshExpedition(ctx, expedition, extra = {}) {
  if (!expedition?.channel_id || !expedition.message_id) return;
  const channel = await fetchChannel(ctx, expedition.channel_id);
  const message = await channel?.messages?.fetch(expedition.message_id).catch(() => null);
  await message?.edit(expeditionPayload(ctx, expedition, extra)).catch(() => {});
}

/** Posts the public "off on an expedition" message and schedules its update for the pet's return. */
async function announceExpedition(ctx, expedition, send) {
  const message = await send(expeditionPayload(ctx, expedition));
  if (message?.id) getServices(ctx).pets.setExpeditionMessage(expedition.id, message.channelId ?? expedition.channel_id, message.id);
  ctx.scheduler.schedule('pet:expedition-return', expedition.ends_at, { expeditionId: expedition.id }, { dedupeKey: `pet-expedition:${expedition.id}` });
}

// ── Battles ─────────────────────────────────────────────────────────────

async function refreshBattle(ctx, result) {
  const { battle } = result;
  if (!battle?.channel_id || !battle.message_id) return;
  const channel = await fetchChannel(ctx, battle.channel_id);
  const message = await channel?.messages?.fetch(battle.message_id).catch(() => null);
  await message?.edit(battlePayload(ctx, battle, result)).catch(() => {});
}

// ── Command ─────────────────────────────────────────────────────────────

const petOption = (required = false) => (o) => o.setName('pet').setDescription(required ? 'Which pet' : 'Which pet (your active pet if empty)')
  .setAutocomplete(true).setRequired(required);
const userOption = (o) => o.setName('user').setDescription('Member (defaults to you)');

const SPECIES_CHOICES = Object.entries(SPECIES).filter(([, s]) => !['legendary', 'mythic'].includes(s.rarity)).map(([value, s]) => ({ name: `${s.name} (${s.rarity})`, value }));
const EGG_CHOICES = Object.keys(EGGS).map((value) => ({ name: ITEMS[value].name, value }));
const STAT_CHOICES = Object.entries(STATS).map(([value, s]) => ({ name: s.label, value }));
const DESTINATION_CHOICES = Object.entries(DESTINATIONS).map(([value, d]) => ({ name: `${d.name} (level ${d.minLevel}+)`, value }));

const data = new SlashCommandBuilder().setName('pet').setDescription('Adopt, raise and battle pets')
  .addSubcommand((s) => s.setName('dashboard').setDescription('Open your pet dashboard'))
  .addSubcommand((s) => s.setName('adopt').setDescription('Adopt a pet or hatch an egg')
    .addStringOption((o) => o.setName('species').setDescription('Pet to adopt').addChoices(...SPECIES_CHOICES))
    .addStringOption((o) => o.setName('egg').setDescription('Egg to hatch').addChoices(...EGG_CHOICES)))
  .addSubcommand((s) => s.setName('profile').setDescription('View a pet').addStringOption(petOption()).addUserOption(userOption))
  .addSubcommand((s) => s.setName('collection').setDescription('Browse a pet collection').addUserOption(userOption))
  .addSubcommand((s) => s.setName('equip').setDescription('Choose your active pet').addStringOption(petOption(true)))
  .addSubcommand((s) => s.setName('rename').setDescription('Name a pet')
    .addStringOption((o) => o.setName('name').setDescription('2–24 characters').setRequired(true).setMaxLength(24))
    .addStringOption(petOption()))
  .addSubcommand((s) => s.setName('rename-reset').setDescription('Restore a pet\'s species name').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('feed').setDescription('Feed a pet')
    .addStringOption((o) => o.setName('food').setDescription('Food (free kibble if empty)').setAutocomplete(true))
    .addStringOption(petOption()))
  .addSubcommand((s) => s.setName('play').setDescription('Play with a pet').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('train').setDescription('Train a stat')
    .addStringOption((o) => o.setName('stat').setDescription('Stat to train').setRequired(true).addChoices(...STAT_CHOICES))
    .addStringOption(petOption()))
  .addSubcommand((s) => s.setName('sleep').setDescription('Nap to restore energy, or wake up').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('explore').setDescription('A short outing for coins and items').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('expedition').setDescription('Send a pet on an expedition')
    .addStringOption((o) => o.setName('destination').setDescription('Where to (shows your expeditions if empty)').addChoices(...DESTINATION_CHOICES))
    .addStringOption(petOption()))
  .addSubcommand((s) => s.setName('evolve').setDescription('Evolve a pet').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('abilities').setDescription('A pet\'s battle abilities').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('stats').setDescription('A pet\'s stats').addStringOption(petOption()).addUserOption(userOption))
  .addSubcommand((s) => s.setName('cosmetics').setDescription('Your pet accessories').addStringOption(petOption()))
  .addSubcommand((s) => s.setName('equip-cosmetic').setDescription('Put an accessory on a pet')
    .addStringOption((o) => o.setName('cosmetic').setDescription('Accessory').setRequired(true).setAutocomplete(true))
    .addStringOption(petOption()))
  .addSubcommand((s) => s.setName('release').setDescription('Release a pet (asks you to confirm)').addStringOption(petOption(true)))
  .addSubcommand((s) => s.setName('leaderboard').setDescription('The top pets')
    .addStringOption((o) => o.setName('sort').setDescription('Ranking').addChoices(...PET_LEADERBOARD_CHOICES)))
  .addSubcommand((s) => s.setName('battle').setDescription('Challenge a member\'s pet')
    .addUserOption((o) => o.setName('opponent').setDescription('Who to battle').setRequired(true))
    .addStringOption(petOption()));

/** The pet a command refers to: someone else's active pet, or one of your own. */
function targetPet(ctx, interaction) {
  const { pets } = getServices(ctx);
  const user = interaction.options.getUser('user');
  if (user && user.id !== interaction.user.id) {
    const pet = pets.active(interaction.guildId, user.id) ?? pets.forOwner(interaction.guildId, user.id)[0];
    if (!pet) throw new UserError(`<@${user.id}> does not have a pet yet.`, { title: 'No pet' });
    return pet;
  }
  return pets.resolve(interaction.guildId, interaction.user.id, interaction.options.getString('pet'));
}

const SUBCOMMANDS = {
  dashboard(interaction, ctx) {
    const { pets } = getServices(ctx);
    const all = pets.forOwner(interaction.guildId, interaction.user.id);
    if (!all.length) return interaction.reply({ ...adoptionCentrePayload(ctx, interaction.guildId, interaction.user.id, settings(ctx, interaction.guildId)), flags: EPHEMERAL });
    const pet = all.find((p) => p.active) ?? all[0];
    const ready = pets.activeExpeditions(interaction.guildId, interaction.user.id).filter((e) => Date.now() >= e.ends_at).length;
    const summary = [`You have ${all.length} pet${all.length === 1 ? '' : 's'}.`, ready ? `🎁 ${ready} expedition${ready === 1 ? ' is' : 's are'} ready to claim.` : null].filter(Boolean).join(' ');
    return interaction.reply(profilePayload(ctx, pet, { feedback: summary }));
  },

  adopt(interaction, ctx) {
    const { pets } = getServices(ctx);
    const egg = interaction.options.getString('egg');
    const species = interaction.options.getString('species');
    const args = { ...base(interaction), settings: settings(ctx, interaction.guildId) };
    if (egg) return interaction.reply({ ...hatchOfferPayload(ctx, interaction.guildId, pets.prepareHatch({ ...args, egg })), flags: EPHEMERAL });
    if (species) return interaction.reply({ ...adoptionOfferPayload(ctx, interaction.guildId, pets.prepareAdoption({ ...args, species })), flags: EPHEMERAL });
    return interaction.reply({ ...adoptionCentrePayload(ctx, interaction.guildId, interaction.user.id, args.settings), flags: EPHEMERAL });
  },

  profile: (interaction, ctx) => interaction.reply(profilePayload(ctx, targetPet(ctx, interaction))),
  collection: (interaction, ctx) => interaction.reply(collectionPayload(ctx, interaction.guildId, (interaction.options.getUser('user') ?? interaction.user).id)),
  abilities: (interaction, ctx) => interaction.reply({ embeds: [abilitiesEmbed(ctx, targetPet(ctx, interaction))], flags: EPHEMERAL }),
  stats: (interaction, ctx) => interaction.reply({ embeds: [statsEmbed(ctx, targetPet(ctx, interaction))], flags: EPHEMERAL }),
  cosmetics: (interaction, ctx) => interaction.reply({ ...cosmeticsPayload(ctx, targetPet(ctx, interaction)), flags: EPHEMERAL }),
  evolve: (interaction, ctx) => interaction.reply({ ...evolutionPayload(ctx, targetPet(ctx, interaction)), flags: EPHEMERAL }),
  leaderboard: (interaction, ctx) => interaction.reply(leaderboardPayload(ctx, interaction.guildId, interaction.options.getString('sort') ?? 'level')),

  equip(interaction, ctx) {
    const pet = getServices(ctx).pets.equip({ ...base(interaction), petId: interaction.options.getString('pet', true) });
    return interaction.reply({ embeds: [kitFor(ctx, interaction).success('Active pet', `⭐ ${petLabel(pet)} is now your active pet.`)], flags: EPHEMERAL });
  },

  rename(interaction, ctx) {
    const pet = getServices(ctx).pets.rename({ ...base(interaction), petId: interaction.options.getString('pet'), name: interaction.options.getString('name', true) });
    return interaction.reply({ embeds: [kitFor(ctx, interaction).success('Renamed', `Your ${stageName(pet)} is now called **${displayName(pet)}**.`)], flags: EPHEMERAL });
  },

  'rename-reset'(interaction, ctx) {
    const pet = getServices(ctx).pets.rename({ ...base(interaction), petId: interaction.options.getString('pet'), name: null });
    return interaction.reply({ embeds: [kitFor(ctx, interaction).success('Name restored', `${petLabel(pet)} uses its species name again.`)], flags: EPHEMERAL });
  },

  feed(interaction, ctx) {
    const result = runCare(ctx, interaction, 'feed', { petId: interaction.options.getString('pet'), food: interaction.options.getString('food') ?? 'kibble' });
    return interaction.reply(profilePayload(ctx, result.pet, { feedback: careFeedback('feed', result) }));
  },

  train(interaction, ctx) {
    const result = runCare(ctx, interaction, 'train', { petId: interaction.options.getString('pet'), stat: interaction.options.getString('stat', true) });
    return interaction.reply(profilePayload(ctx, result.pet, { feedback: careFeedback('train', result) }));
  },

  ...Object.fromEntries(['play', 'sleep', 'explore'].map((action) => [action, (interaction, ctx) => {
    const result = runCare(ctx, interaction, action, { petId: interaction.options.getString('pet') });
    return interaction.reply(profilePayload(ctx, result.pet, { feedback: careFeedback(action, result) }));
  }])),

  async expedition(interaction, ctx) {
    const destination = interaction.options.getString('destination');
    if (!destination) return interaction.reply({ ...expeditionPanel(ctx, interaction.guildId, interaction.user.id), flags: EPHEMERAL });
    const { expedition } = getServices(ctx).pets.startExpedition({
      ...base(interaction), petId: interaction.options.getString('pet'), destination, channelId: interaction.channelId,
    });
    return announceExpedition(ctx, expedition, async (payload) => (await interaction.reply({ ...payload, withResponse: true }))?.resource?.message);
  },

  'equip-cosmetic'(interaction, ctx) {
    const item = interaction.options.getString('cosmetic', true);
    const result = getServices(ctx).pets.equipCosmetic({ ...base(interaction), petId: interaction.options.getString('pet'), item });
    const replaced = result.replaced ? ` ${itemLabel(result.replaced)} went back to your inventory.` : '';
    return interaction.reply({ embeds: [kitFor(ctx, interaction).success('Looking good', `${petLabel(result.pet)} is now wearing ${itemLabel(item)}.${replaced}`)], flags: EPHEMERAL });
  },

  release(interaction, ctx) {
    const pet = getServices(ctx).pets.resolve(interaction.guildId, interaction.user.id, interaction.options.getString('pet', true));
    const embed = kitFor(ctx, interaction).warning(`Release ${displayName(pet)}?`, [
      `${petLabel(pet)} · ${stageName(pet)} · level ${petLevelForXp(pet.xp)}`,
      '',
      '**This cannot be undone.** The pet leaves your collection for good, along with its level and training.',
      'Its accessories go back to your inventory, and the species stays in your discovered collection.',
      '',
      `To confirm, press the button and type **${displayName(pet)}**.`,
    ].join('\n'));
    const confirm = button(cid('pet', 'release', pet.id), { label: `Release ${displayName(pet)}…`, style: ButtonStyle.Danger });
    return interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(confirm)], flags: EPHEMERAL });
  },

  async battle(interaction, ctx) {
    const opponent = interaction.options.getUser('opponent', true);
    const member = await interaction.guild.members.fetch(opponent.id).catch(() => null);
    if (!member) throw new UserError('That member is not in this server.', { title: 'Invalid opponent' });
    if (opponent.bot) throw new UserError('Bots do not have pets.', { title: 'Invalid opponent' });
    const { petBattles } = getServices(ctx);
    const battle = petBattles.challenge({
      guildId: interaction.guildId, hostId: interaction.user.id, opponentId: opponent.id, petId: interaction.options.getString('pet'),
      channelId: interaction.channelId, settings: settings(ctx, interaction.guildId),
    });
    const response = await interaction.reply({
      ...battlePayload(ctx, battle), content: `<@${opponent.id}>, your pet has been challenged!`, allowedMentions: { users: [opponent.id] }, withResponse: true,
    });
    const message = response?.resource?.message;
    if (message?.id) petBattles.setMessage(battle.id, message.channelId ?? interaction.channelId, message.id);
  },
};

function autocompleteChoices(interaction, ctx) {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value ?? '').toLowerCase();
  const { pets, inventory } = getServices(ctx);
  const matches = (choice) => choice.name.toLowerCase().includes(query);
  if (focused.name === 'pet') {
    return pets.forOwner(interaction.guildId, interaction.user.id).map((pet) => ({ name: truncate(petOptionLabel(pet), 100), value: String(pet.id) })).filter(matches);
  }
  if (focused.name === 'food') {
    const owned = inventory.list(interaction.guildId, interaction.user.id, 'food').map(({ item, quantity }) => {
      const effect = ITEMS[item].food;
      const gains = [effect.happiness ? `+${effect.happiness} happiness` : null, effect.energy ? `+${effect.energy} energy` : null, effect.xp ? `+${effect.xp} XP` : null].filter(Boolean).join(', ');
      return { name: truncate(`${ITEMS[item].name} ×${quantity} (${gains})`, 100), value: item };
    });
    return [{ name: `Kibble (free, +${CARE.kibble.happiness} happiness, every 30 minutes)`, value: 'kibble' }, ...owned].filter(matches);
  }
  if (focused.name === 'cosmetic') {
    const owned = new Map(inventory.list(interaction.guildId, interaction.user.id, 'pet_cosmetic').map((e) => [e.item, e.quantity]));
    return itemsOfKind('pet_cosmetic').filter((key) => owned.has(key))
      .map((key) => ({ name: `${ITEMS[key].name} (${ITEMS[key].slot}) ×${owned.get(key)}`, value: key })).filter(matches);
  }
  return [];
}

const command = {
  data,
  category: 'Pets',
  tier: 'member',
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'leaderboard') assertPetsEnabled(ctx, interaction.guildId);
    return SUBCOMMANDS[sub](interaction, ctx);
  },
  autocomplete: (interaction, ctx) => interaction.respond(autocompleteChoices(interaction, ctx).slice(0, 25)),
};

// ── Components ──────────────────────────────────────────────────────────

/** Pet components check the server's pet switch before doing anything. */
const component = (id, execute, extra = {}) => ({
  id,
  ...extra,
  execute(interaction, ctx, args) {
    assertPetsEnabled(ctx, interaction.guildId);
    return execute(interaction, ctx, args);
  },
});

function viewablePet(ctx, petId) {
  const pet = getServices(ctx).pets.get(Number(petId));
  if (!pet || pet.status === 'released') throw new UserError('That pet is no longer here.', { title: 'Pet not found' });
  return pet;
}

const components = [
  component('pet:care', (interaction, ctx, [petId, action]) => {
    if (!CARE_ACTIONS[action] || action === 'train') throw new UserError('That action is not available.', { title: 'Unknown action' });
    const result = runCare(ctx, interaction, action, { petId });
    return interaction.update(profilePayload(ctx, result.pet, { feedback: careFeedback(action, result) }));
  }),
  component('pet:train', (interaction, ctx, [petId]) => {
    const result = runCare(ctx, interaction, 'train', { petId, stat: interaction.values[0] });
    return interaction.update(profilePayload(ctx, result.pet, { feedback: careFeedback('train', result) }));
  }),
  component('pet:equip', (interaction, ctx, [petId]) => {
    const pet = getServices(ctx).pets.equip({ ...base(interaction), petId });
    return interaction.update(profilePayload(ctx, pet, { feedback: `⭐ ${displayName(pet)} is now your active pet.` }));
  }),
  component('pet:view', (interaction, ctx, [petId, view]) => {
    const pet = viewablePet(ctx, petId);
    if (view === 'abilities') return interaction.reply({ embeds: [abilitiesEmbed(ctx, pet)], flags: EPHEMERAL });
    if (view === 'stats') return interaction.reply({ embeds: [statsEmbed(ctx, pet)], flags: EPHEMERAL });
    return interaction.reply({ ...cosmeticsPayload(ctx, pet), flags: EPHEMERAL });
  }),
  component('pet:unequip', (interaction, ctx, [petId, slot]) => {
    const result = getServices(ctx).pets.unequipCosmetic({ ...base(interaction), petId, slot });
    return interaction.update(cosmeticsPayload(ctx, result.pet));
  }),
  component('pet:collection', (interaction, ctx, [ownerId, filter, page]) => interaction.update(collectionPayload(ctx, interaction.guildId, ownerId, filter, Number(page))), { tier: 'restricted' }),
  component('pet:filter', (interaction, ctx, [ownerId]) => interaction.update(collectionPayload(ctx, interaction.guildId, ownerId, interaction.values[0], 1)), { tier: 'restricted' }),
  component('pet:pick', (interaction, ctx) => interaction.update(profilePayload(ctx, viewablePet(ctx, interaction.values[0]))), { tier: 'restricted' }),
  component('pet:lb', (interaction, ctx, [metric, page]) => interaction.update(leaderboardPayload(ctx, interaction.guildId, metric, Number(page))), { tier: 'restricted' }),

  // Adoption and hatching: each offer card is single-use (economy_pending), so a double click adopts once.
  component('pet:adoptpick', (interaction, ctx) => {
    const offer = getServices(ctx).pets.prepareAdoption({ ...base(interaction), species: interaction.values[0], settings: settings(ctx, interaction.guildId) });
    return interaction.update(adoptionOfferPayload(ctx, interaction.guildId, offer));
  }),
  component('pet:adoptyes', (interaction, ctx, [pendingId]) => {
    const result = getServices(ctx).pets.confirmAdoption({ pendingId, userId: interaction.user.id, settings: settings(ctx, interaction.guildId) });
    return interaction.update(welcomePayload(ctx, result));
  }),
  component('pet:hatchyes', (interaction, ctx, [pendingId]) => {
    const result = getServices(ctx).pets.confirmHatch({ pendingId, userId: interaction.user.id, settings: settings(ctx, interaction.guildId) });
    return interaction.update(welcomePayload(ctx, result));
  }),
  component('pet:offerno', (interaction, ctx, [pendingId]) => {
    getServices(ctx).economy.cancelPending(pendingId, interaction.user.id);
    return interaction.update({ embeds: [kitFor(ctx, interaction).info('Cancelled', 'Nothing was charged or used.')], components: [] });
  }),

  // Evolution and release.
  component('pet:evolveyes', async (interaction, ctx, [petId]) => {
    const result = getServices(ctx).pets.evolve({ ...base(interaction), petId, settings: settings(ctx, interaction.guildId) });
    const lines = [`**${displayName(result.before)}** evolved from ${stageName(result.before)} into **${stageName(result.pet)}**!`, ...progressionLines(result.progression)];
    await interaction.update({ embeds: [kitFor(ctx, interaction).success('Evolution complete', lines.join('\n'))], components: [] });
    await interaction.followUp({ embeds: [kitFor(ctx, interaction).base({ title: '🌟 Evolution!', description: `<@${interaction.user.id}>'s ${displayName(result.before)} evolved into a **${stageName(result.pet)}**!` })], allowedMentions: { parse: [] } });
  }),
  component('pet:release', (interaction, ctx, [petId]) => {
    const pet = getServices(ctx).pets.resolve(interaction.guildId, interaction.user.id, petId);
    const modal = new ModalBuilder().setCustomId(cid('pet', 'releaseok', pet.id)).setTitle(truncate(`Release ${displayName(pet)}`, 45))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name')
        .setLabel(truncate(`Type "${displayName(pet)}" to confirm`, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)));
    return interaction.showModal(modal);
  }),
  component('pet:releaseok', (interaction, ctx, [petId]) => {
    const { pet } = getServices(ctx).pets.release({ ...base(interaction), petId, confirmation: interaction.fields.getTextInputValue('name') });
    const payload = { embeds: [kitFor(ctx, interaction).info('Released', `${petLabel(pet)} has gone to a happy new home. Goodbye, ${displayName(pet)}!`)], components: [] };
    return interaction.isFromMessage() ? interaction.update(payload) : interaction.reply({ ...payload, flags: EPHEMERAL });
  }),

  // Expeditions.
  component('pet:expeditions', (interaction, ctx) => interaction.reply({ ...expeditionPanel(ctx, interaction.guildId, interaction.user.id), flags: EPHEMERAL })),
  component('pet:expgo', async (interaction, ctx) => {
    const { expedition } = getServices(ctx).pets.startExpedition({ ...base(interaction), destination: interaction.values[0], channelId: interaction.channelId });
    await interaction.update(expeditionPanel(ctx, interaction.guildId, interaction.user.id));
    await announceExpedition(ctx, expedition, (payload) => interaction.followUp(payload));
  }),
  component('pet:expclaim', async (interaction, ctx, [expeditionId]) => {
    const result = getServices(ctx).pets.claimExpedition({ expeditionId, userId: interaction.user.id, settings: settings(ctx, interaction.guildId) });
    const extra = { levels: result.levels, progressionLines: progressionLines(result.progression) };
    if (interaction.message?.id === result.expedition.message_id) return interaction.update(expeditionPayload(ctx, result.expedition, extra));
    await interaction.update(expeditionPanel(ctx, interaction.guildId, interaction.user.id));
    await interaction.followUp({ ...expeditionPayload(ctx, result.expedition, extra), flags: EPHEMERAL });
    return refreshExpedition(ctx, result.expedition, extra);
  }),
  component('pet:exprecall', async (interaction, ctx, [expeditionId]) => {
    const result = getServices(ctx).pets.recallExpedition({ expeditionId, userId: interaction.user.id });
    if (interaction.message?.id === result.expedition.message_id) return interaction.update(expeditionPayload(ctx, result.expedition));
    await interaction.update(expeditionPanel(ctx, interaction.guildId, interaction.user.id));
    return refreshExpedition(ctx, result.expedition);
  }),

  // Battles.
  component('petbattle:accept', (interaction, ctx, [battleId]) => {
    const { petBattles, pets } = getServices(ctx);
    const battle = petBattles.get(battleId);
    if (!battle || battle.opponent_id !== interaction.user.id) throw new UserError('This challenge is not for you.', { title: 'Not your battle' });
    const eligible = petBattles.eligiblePets(interaction.guildId, interaction.user.id);
    if (!eligible.length) {
      throw new UserError(pets.forOwner(interaction.guildId, interaction.user.id).length
        ? 'None of your pets can battle right now. A pet must be at home, awake and have enough energy.'
        : 'You need a pet to battle. Adopt one with `/pet adopt`.', { title: 'No pet ready' });
    }
    if (eligible.length === 1) {
      const started = petBattles.accept({ battleId, userId: interaction.user.id, petId: eligible[0].id });
      return interaction.update({ ...battlePayload(ctx, started), content: null });
    }
    const menu = new StringSelectMenuBuilder().setCustomId(cid('petbattle', 'pick', battleId)).setPlaceholder('Choose your pet')
      .addOptions(eligible.slice(0, 25).map((pet) => ({ label: truncate(petOptionLabel(pet), 100), value: String(pet.id), emoji: SPECIES[pet.species].emoji, default: Boolean(pet.active) })));
    return interaction.reply({ embeds: [kitFor(ctx, interaction).base({ title: '⚔️ Choose your pet', description: 'Which pet will battle?' })], components: [new ActionRowBuilder().addComponents(menu)], flags: EPHEMERAL });
  }),
  component('petbattle:pick', async (interaction, ctx, [battleId]) => {
    const battle = getServices(ctx).petBattles.accept({ battleId, userId: interaction.user.id, petId: interaction.values[0] });
    await interaction.update({ embeds: [kitFor(ctx, interaction).success('Battle on!', 'The battle has started in the channel.')], components: [] });
    return refreshBattle(ctx, { battle });
  }),
  component('petbattle:decline', (interaction, ctx, [battleId]) => {
    const result = getServices(ctx).petBattles.decline({ battleId, userId: interaction.user.id });
    return interaction.update(battlePayload(ctx, result.battle));
  }),
  component('petbattle:forfeit', (interaction, ctx, [battleId]) => {
    const result = getServices(ctx).petBattles.forfeit({ battleId, userId: interaction.user.id, settings: settings(ctx, interaction.guildId) });
    return interaction.update(battlePayload(ctx, result.battle, result));
  }),
  component('petbattle:move', (interaction, ctx, [battleId, move]) => {
    const result = getServices(ctx).petBattles.act({ battleId, userId: interaction.user.id, move, settings: settings(ctx, interaction.guildId) });
    return interaction.update(battlePayload(ctx, result.battle, result));
  }),
];

export default {
  commands: [command],
  components,
  events: [
    {
      // A member who leaves forfeits their running pet battles; their open challenges close.
      name: Events.GuildMemberRemove,
      async execute(member, ctx) {
        const results = getServices(ctx).petBattles.cancelForMember({ guildId: member.guild.id, userId: member.id, settings: settings(ctx, member.guild.id) });
        for (const result of results) await refreshBattle(ctx, result);
      },
    },
  ],
  jobs: [
    {
      // Scheduled when a pet leaves; turns the expedition message into "back, claim the finds".
      type: 'pet:expedition-return',
      async execute({ expeditionId }, task, ctx) {
        const expedition = getServices(ctx).pets.expedition(expeditionId);
        if (expedition?.status === 'active') await refreshExpedition(ctx, expedition);
      },
    },
    {
      // Expires unanswered challenges and forfeits players who stop moving.
      type: 'community:pet-battles-expire',
      every: 60_000,
      async execute(payload, task, ctx) {
        for (const result of getServices(ctx).petBattles.expireDue(Date.now(), (guildId) => settings(ctx, guildId))) {
          if (result.error) ctx.logger.error('Pet battle expiry failed', { id: result.id, error: result.error.message });
          else await refreshBattle(ctx, result);
        }
      },
    },
  ],
};
