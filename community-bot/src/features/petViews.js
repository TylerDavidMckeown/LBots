import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from 'discord.js';
import { pageRow, paginate } from '@lyss/shared/utils/pagination.js';
import { formatNumber, plural, progressBar, truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp, formatDuration } from '@lyss/shared/utils/time.js';
import { formatCoins } from '../services/economyRules.js';
import { getServices } from '../services/index.js';
import {
  COSMETIC_SLOTS, ITEMS, itemLabel, itemList, RARITIES, rarityLabel,
} from '../services/items.js';
import { MAX_EXPEDITIONS, PET_LEADERBOARD_CHOICES } from '../services/petService.js';
import { BATTLE, battleMoves } from '../services/pets/battle.js';
import {
  ABILITIES, ABILITY_LEVELS, COLLECTION_MILESTONES, DESTINATIONS, EVOLUTION, SPECIES, STATS, TRAITS,
} from '../services/pets/catalogue.js';
import {
  adoptionPrice, CARE, displayName, MAX_PET_LEVEL, moodFor, petLabel, petLevelForXp, petStats, slotUnlocked, speciesLabel,
  stageName, trainingCap, unlockedAbilities, xpForPetLevel,
} from '../services/pets/rules.js';
import { cid } from './common.js';

/** Rendering for pets: profiles, collections, expeditions, battles and leaderboards. */

const PER_PAGE = 10;

export function button(customId, { label, emoji, style = ButtonStyle.Secondary, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(truncate(label, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const select = (customId, placeholder, options) => new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder)
  .addOptions(options.slice(0, 25).map((o) => ({ ...o, label: truncate(o.label, 100), description: o.description ? truncate(o.description, 100) : undefined })));

const ABILITY_KIND = {
  strike: (a) => `Hits for ×${a.power} damage`,
  pierce: (a) => `Hits for ×${a.power} damage, ignoring half the target's guard and any shield`,
  drain: (a) => `Hits for ×${a.power} damage and heals ${Math.round(a.heal * 100)}% of the damage dealt`,
  heal: (a) => `Restores ${Math.round(a.heal * 100)}% of max health`,
  shield: (a) => `Blocks ${Math.round(a.block * 100)}% of the next hit`,
  focus: (a) => `The next attack deals ×${a.boost} damage`,
};
export const abilityText = (key) => `${ABILITIES[key].emoji} **${ABILITIES[key].name}**: ${ABILITY_KIND[ABILITIES[key].kind](ABILITIES[key])} · recharges in ${ABILITIES[key].cooldown} turns`;

export function levelLine(pet) {
  const level = petLevelForXp(pet.xp);
  if (level >= MAX_PET_LEVEL) return `Level ${level} (max) · ${formatNumber(pet.xp)} XP`;
  const floor = xpForPetLevel(level);
  const span = xpForPetLevel(level + 1) - floor;
  return `Level ${level} · ${formatNumber(pet.xp - floor)} / ${formatNumber(span)} XP\n${progressBar(pet.xp - floor, span, 10)}`;
}

export function statusLine(pet) {
  if (pet.status === 'sleeping') return `💤 Napping until ${discordTimestamp(pet.busy_until, 't')}`;
  if (pet.status === 'expedition') return `🧭 On an expedition, back ${discordTimestamp(pet.busy_until, 'R')}`;
  if (pet.status === 'battle') return '⚔️ In a battle';
  return null;
}

/** "🎉 Biscuit reached level 10!" plus anything the new level unlocked. */
export function petLevelLines(pet, levels) {
  if (!levels || levels.levelAfter <= levels.levelBefore) return [];
  return [`🎉 **${displayName(pet)} reached level ${levels.levelAfter}!**`, ...levels.unlocks.map((u) => `🔓 ${u}`)];
}

// ── Profile ─────────────────────────────────────────────────────────────

export function petEmbed(ctx, pet, { feedback = null } = {}) {
  const kit = ctx.embeds.for(pet.guild_id);
  const species = SPECIES[pet.species];
  const mood = moodFor(pet.happiness);
  const stats = petStats(pet);
  const abilities = unlockedAbilities(pet);
  const nextAbility = species.abilities.findIndex((key) => !abilities.includes(key));
  const worn = Object.fromEntries(getServices(ctx).pets.cosmetics(pet.id).map((c) => [c.slot, c.item_key]));
  const description = [
    `${speciesLabel(pet)} · ${rarityLabel(species.rarity)} · ${species.theme}`,
    `Stage ${pet.stage} of 3${pet.active ? ' · ⭐ Active pet' : ''} · Owner <@${pet.owner_id}>`,
    statusLine(pet),
    feedback ? `\n${feedback}` : null,
  ].filter(Boolean).join('\n');
  const accessories = Object.entries(COSMETIC_SLOTS).map(([slot, def]) => {
    if (worn[slot]) return `${def.label}: ${itemLabel(worn[slot])}`;
    return `${def.label}: ${slotUnlocked(pet, slot) ? 'empty' : `🔒 opens ${def.unlockText}`}`;
  });
  return kit.base({ title: petLabel(pet), description })
    .addFields(
      { name: '📈 Level', value: levelLine(pet), inline: true },
      { name: `${mood.emoji} Happiness`, value: `${pet.happiness}/100 · ${mood.label}${mood.xpBonus ? ` (+${mood.xpBonus * 100}% XP)` : ''}\n${progressBar(pet.happiness, 100, 10)}`, inline: true },
      { name: '⚡ Energy', value: `${pet.energy}/100\n${progressBar(pet.energy, 100, 10)}`, inline: true },
      { name: '🧬 Traits', value: pet.traits.map((t) => `${TRAITS[t].emoji} **${TRAITS[t].name}**: ${TRAITS[t].description}`).join('\n') || 'None' },
      {
        name: '✨ Abilities',
        value: [
          ...abilities.map((key) => `${ABILITIES[key].emoji} ${ABILITIES[key].name}`),
          nextAbility >= 0 ? `🔒 ${ABILITIES[species.abilities[nextAbility]].name} at level ${ABILITY_LEVELS[nextAbility]}` : null,
        ].filter(Boolean).join(' · '),
      },
      { name: '🎀 Accessories', value: accessories.join('\n'), inline: true },
      {
        name: '⚔️ Battle',
        value: `${Object.entries(STATS).map(([key, s]) => `${s.emoji} ${stats[key]}`).join(' · ')}\nRecord: ${pet.battles_won}W – ${pet.battles_lost}L`,
        inline: true,
      },
      { name: '📅 Adopted', value: `${discordTimestamp(pet.adopted_at, 'D')}${pet.evolved_at ? `\nEvolved ${discordTimestamp(pet.evolved_at, 'D')}` : ''}`, inline: true },
    );
}

/** Owner controls. Anyone can see them; the service only lets the owner act. */
export function petControls(pet) {
  const away = pet.status === 'expedition' || pet.status === 'battle';
  const awake = pet.status !== 'sleeping';
  const care = (action, label, emoji) => button(cid('pet', 'care', pet.id, action), { label, emoji, disabled: away || !awake });
  const cap = trainingCap(petLevelForXp(pet.xp), pet.stage);
  return [
    row(
      care('feed', 'Feed', CARE.kibble.emoji),
      care('play', 'Play', '🎾'),
      care('explore', 'Explore', '🧭'),
      button(cid('pet', 'care', pet.id, 'sleep'), { label: awake ? 'Nap' : 'Wake up', emoji: awake ? '💤' : '☀️', disabled: away }),
      button(cid('pet', 'equip', pet.id), { label: pet.active ? 'Active' : 'Make active', emoji: '⭐', disabled: Boolean(pet.active) }),
    ),
    row(select(cid('pet', 'train', pet.id), `🏋️ Train a stat (costs ${CARE.train.energy} energy)`, Object.entries(STATS).map(([key, s]) => ({
      label: `Train ${s.label}`, value: key, emoji: s.emoji, description: `${pet.training[key] ?? 0} / ${cap} trained · ${s.description}`,
    }))).setDisabled(away || !awake)),
    row(
      button(cid('pet', 'view', pet.id, 'abilities'), { label: 'Abilities', emoji: '✨' }),
      button(cid('pet', 'view', pet.id, 'stats'), { label: 'Stats', emoji: '📊' }),
      button(cid('pet', 'view', pet.id, 'cosmetics'), { label: 'Accessories', emoji: '🎀' }),
      button(cid('pet', 'expeditions'), { label: 'Expeditions', emoji: '🗺️' }),
      button(cid('pet', 'collection', pet.owner_id, 'all', 1), { label: 'Collection', emoji: '📚' }),
    ),
  ];
}

export const profilePayload = (ctx, pet, options = {}) => ({
  embeds: [petEmbed(ctx, pet, options)], components: petControls(pet), allowedMentions: { parse: [] },
});

export function abilitiesEmbed(ctx, pet) {
  const kit = ctx.embeds.for(pet.guild_id);
  const level = petLevelForXp(pet.xp);
  const lines = SPECIES[pet.species].abilities.map((key, i) => `${level >= ABILITY_LEVELS[i] ? '✅' : `🔒 Level ${ABILITY_LEVELS[i]} ·`} ${abilityText(key)}`);
  return kit.base({ title: `✨ ${displayName(pet)}'s abilities`, description: lines.join('\n\n') }).addFields({
    name: 'Every pet can also',
    value: `⚔️ **Attack**: a normal hit\n🛡️ **Guard**: blocks ${Math.round(BATTLE.guardBlock * 100)}% of the next hit and heals ${Math.round(BATTLE.guardHeal * 100)}% of max health`,
  });
}

export function statsEmbed(ctx, pet) {
  const kit = ctx.embeds.for(pet.guild_id);
  const stats = petStats(pet);
  const { base } = SPECIES[pet.species];
  const level = petLevelForXp(pet.xp);
  const cap = trainingCap(level, pet.stage);
  const lines = Object.entries(STATS).map(([key, s]) => {
    const trained = pet.training[key] ?? 0;
    return `${s.emoji} **${s.label} ${stats[key]}** · base ${base[key]} · trained ${trained}/${cap}${pet.stage > 1 ? ` · evolution +${(pet.stage - 1) * 3}` : ''}\n${progressBar(trained, cap, 10)}`;
  });
  return kit.base({ title: `📊 ${displayName(pet)}'s stats`, description: lines.join('\n') }).addFields(
    { name: 'Level', value: `${level} · ${formatNumber(pet.xp)} XP`, inline: true },
    { name: 'Battles', value: `${pet.battles_won} won · ${pet.battles_lost} lost`, inline: true },
    { name: 'Activity', value: `${plural(pet.times_trained, 'training session')} · ${plural(pet.expeditions, 'expedition')}`, inline: true },
  );
}

export function cosmeticsPayload(ctx, pet) {
  const kit = ctx.embeds.for(pet.guild_id);
  const worn = getServices(ctx).pets.cosmetics(pet.id);
  const owned = getServices(ctx).inventory.list(pet.guild_id, pet.owner_id, 'pet_cosmetic');
  const slots = Object.entries(COSMETIC_SLOTS).map(([slot, def]) => {
    const item = worn.find((c) => c.slot === slot)?.item_key;
    return `**${def.label}:** ${item ? itemLabel(item) : slotUnlocked(pet, slot) ? 'empty' : `🔒 opens ${def.unlockText}`}`;
  });
  const embed = kit.base({ title: `🎀 ${displayName(pet)}'s accessories`, description: slots.join('\n') }).addFields({
    name: 'Your accessories',
    value: truncate(owned.map(({ item, quantity }) => `${itemLabel(item)} (${COSMETIC_SLOTS[ITEMS[item].slot].label.toLowerCase()})${quantity > 1 ? ` ×${quantity}` : ''}`).join('\n') || 'None yet. They come from expeditions, level rewards and collection milestones.', 1024),
  }).addFields({ name: 'How to dress up', value: 'Use `/pet equip-cosmetic` to put one on. Accessories are cosmetic only.' });
  const remove = worn.map((c) => button(cid('pet', 'unequip', pet.id, c.slot), { label: `Remove ${ITEMS[c.item_key].name}`, emoji: '✖️' }));
  return { embeds: [embed], components: remove.length ? [row(...remove)] : [] };
}

// ── Collection, catalogue and leaderboards ─────────────────────────────

export const COLLECTION_FILTERS = Object.freeze({
  all: { label: 'All pets', test: () => true },
  active: { label: 'Active pet', test: (pet) => pet.active },
  evolved: { label: 'Evolved pets', test: (pet) => pet.stage > 1 },
  busy: { label: 'Away, napping or battling', test: (pet) => pet.status !== 'idle' },
  ...Object.fromEntries(Object.entries(RARITIES).map(([key, r]) => [key, { label: `${r.label} pets`, emoji: r.emoji, test: (pet) => SPECIES[pet.species].rarity === key }])),
  catalogue: { label: 'Species catalogue (owned and unowned)' },
});

const nextMilestone = (discovered) => COLLECTION_MILESTONES.find((m) => m.species > discovered);
const milestoneText = (m) => [m.coins ? formatCoins(m.coins) : null, m.items?.length ? itemList(m.items) : null, m.title ? 'a title' : null].filter(Boolean).join(', ');

function filterRow(ownerId, current) {
  return row(select(cid('pet', 'filter', ownerId), 'Filter the collection', Object.entries(COLLECTION_FILTERS).map(([value, f]) => ({
    label: f.label, value, emoji: f.emoji, default: value === current,
  }))));
}

export function collectionPayload(ctx, guildId, ownerId, filter = 'all', requestedPage = 1, now = Date.now()) {
  const { pets } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const discovered = pets.discovered(guildId, ownerId).map((d) => d.species);
  const total = Object.keys(SPECIES).length;
  const next = nextMilestone(discovered.length);
  const progress = `${discovered.length} / ${total} species discovered\n${progressBar(discovered.length, total, 10)}${next ? `\nNext: discover ${next.species} for ${milestoneText(next)}` : '\n📚 Every species discovered!'}`;

  if (filter === 'catalogue') {
    const lines = Object.entries(SPECIES).map(([key, s]) => {
      const owned = discovered.includes(key);
      const source = s.starter ? 'starter' : ['legendary', 'mythic'].includes(s.rarity) ? 'eggs only' : 'adoption or eggs';
      return `${owned ? '✅' : '🔒'} ${s.emoji} **${s.name}** · ${rarityLabel(s.rarity)} · ${s.theme} · ${source}`;
    });
    const embed = kit.base({ title: '📖 Species catalogue', description: `<@${ownerId}>\n${progress}\n\n${lines.join('\n')}` });
    return { embeds: [embed], components: [filterRow(ownerId, filter)], allowedMentions: { parse: [] } };
  }

  const all = pets.forOwner(guildId, ownerId, now);
  const shown = all.filter(COLLECTION_FILTERS[filter]?.test ?? (() => true));
  const { items, page, totalPages } = paginate(shown, requestedPage, PER_PAGE);
  const lines = items.map((pet) => {
    const busy = pet.status === 'idle' ? '' : pet.status === 'sleeping' ? ' · 💤' : pet.status === 'expedition' ? ' · 🧭' : ' · ⚔️';
    return `${pet.active ? '⭐' : '▫️'} ${petLabel(pet)} · ${speciesLabel(pet)} · ${RARITIES[SPECIES[pet.species].rarity].emoji} · Lv ${petLevelForXp(pet.xp)}${busy}`;
  });
  const embed = kit.base({
    title: '📚 Pet collection',
    description: truncate(`<@${ownerId}> · ${plural(all.length, 'pet')}\n${progress}\n\n${lines.join('\n') || (all.length ? 'No pets match this filter.' : 'No pets yet. Adopt one with `/pet adopt`.')}`, 4096),
  });
  const components = [filterRow(ownerId, filter)];
  if (items.length) {
    components.push(row(select(cid('pet', 'pick', ownerId), 'Open a pet\'s profile', items.map((pet) => ({
      label: displayName(pet), value: String(pet.id), emoji: SPECIES[pet.species].emoji, description: `${speciesLabel(pet)} · level ${petLevelForXp(pet.xp)}`,
    })))));
  }
  if (totalPages > 1) components.push(pageRow((p) => cid('pet', 'collection', ownerId, filter, p), page, totalPages));
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export function leaderboardPayload(ctx, guildId, metric = 'level', requestedPage = 1) {
  const { pets } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const { page, totalPages } = paginate(Array.from({ length: pets.leaderboardCount(guildId, metric) }), requestedPage, PER_PAGE);
  const rows = pets.leaderboard(guildId, metric, PER_PAGE, (page - 1) * PER_PAGE);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const position = (page - 1) * PER_PAGE + i + 1;
    const rank = medals[position - 1] ?? `**${position}.**`;
    if (metric === 'collection') return `${rank} <@${r.owner_id}> · ${r.n} / ${Object.keys(SPECIES).length} species`;
    const value = metric === 'battles' ? plural(r.battles_won, 'win') : metric === 'expeditions' ? plural(r.expeditions, 'expedition') : `level ${petLevelForXp(r.xp)} · ${formatNumber(r.xp)} XP`;
    return `${rank} ${petLabel(r)} (<@${r.owner_id}>) · ${value}`;
  });
  const label = PET_LEADERBOARD_CHOICES.find((c) => c.value === metric)?.name ?? metric;
  return {
    embeds: [kit.base({ title: `🏆 Pet leaderboard · ${label}`, description: lines.join('\n') || 'No pets have made the board yet.' })],
    components: totalPages > 1 ? [pageRow((p) => cid('pet', 'lb', metric, p), page, totalPages)] : [],
    allowedMentions: { parse: [] },
  };
}

// ── Adoption and evolution ─────────────────────────────────────────────

export function adoptionCentrePayload(ctx, guildId, userId, settings) {
  const { pets, inventory } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const first = !pets.hasEverOwned(guildId, userId);
  const eggs = inventory.list(guildId, userId, 'egg');
  const options = Object.entries(SPECIES)
    .map(([key, s]) => ({ key, s, price: first ? (s.starter ? 0 : null) : adoptionPrice(key, settings) }))
    .filter(({ price }) => price !== null)
    .map(({ key, s, price }) => ({ label: s.name, value: key, emoji: s.emoji, description: `${RARITIES[s.rarity].label} · ${s.theme} · ${price ? `${formatNumber(price)} LC` : 'free'}` }));
  const embed = kit.base({
    title: '🏡 Adoption centre',
    description: first
      ? 'Welcome! Your first pet is **free**. Choose a starter below.'
      : `Choose a pet to adopt. Legendary and mythic pets only hatch from eggs found on expeditions. You can look after up to ${settings.petMax} pets.`,
  });
  if (eggs.length) embed.addFields({ name: '🥚 Your eggs', value: `${itemList(eggs)}\nHatch one with \`/pet adopt egg:\`.` });
  return { embeds: [embed], components: [row(select(cid('pet', 'adoptpick'), 'Choose a pet to adopt', options))] };
}

export function adoptionOfferPayload(ctx, guildId, offer) {
  const s = SPECIES[offer.species];
  const kit = ctx.embeds.for(guildId);
  const embed = kit.base({
    title: `${s.emoji} Adopt a ${s.name}?`,
    description: `${rarityLabel(s.rarity)} · ${s.theme}\nEvolves into ${s.stages[1]} and then ${s.stages[2]}.\n\nIts colour variant and traits are revealed when it arrives.`,
  }).addFields(
    { name: 'Price', value: offer.price ? formatCoins(offer.price) : 'Free', inline: true },
    { name: 'Offer expires', value: discordTimestamp(offer.expiresAt, 'R'), inline: true },
  );
  return {
    embeds: [embed],
    components: [row(
      button(cid('pet', 'adoptyes', offer.pendingId), { label: offer.price ? `Adopt for ${formatNumber(offer.price)} LC` : 'Adopt', emoji: '🏡', style: ButtonStyle.Success }),
      button(cid('pet', 'offerno', offer.pendingId), { label: 'Cancel', style: ButtonStyle.Secondary }),
    )],
  };
}

export function hatchOfferPayload(ctx, guildId, offer) {
  const kit = ctx.embeds.for(guildId);
  const lines = offer.odds.map(({ species, chance }) => `${SPECIES[species].emoji} ${SPECIES[species].name} · ${RARITIES[SPECIES[species].rarity].label} · **${(chance * 100).toFixed(chance < 0.01 ? 2 : 1)}%**`);
  const embed = kit.base({ title: `${itemLabel(offer.egg)}: hatch it?`, description: `${ITEMS[offer.egg].description}\n\n**What it can hatch into**\n${lines.join('\n')}` })
    .addFields({ name: 'Offer expires', value: discordTimestamp(offer.expiresAt, 'R') });
  return {
    embeds: [embed],
    components: [row(
      button(cid('pet', 'hatchyes', offer.pendingId), { label: 'Hatch the egg', emoji: '🐣', style: ButtonStyle.Success }),
      button(cid('pet', 'offerno', offer.pendingId), { label: 'Keep it for later', style: ButtonStyle.Secondary }),
    )],
  };
}

export function evolutionPayload(ctx, pet) {
  const kit = ctx.embeds.for(pet.guild_id);
  const next = EVOLUTION[pet.stage + 1];
  if (!next) {
    return { embeds: [kit.info(`${displayName(pet)} is fully evolved`, `${stageName(pet)} is the final stage of ${SPECIES[pet.species].name}.`)], components: [] };
  }
  const { inventory, economy } = getServices(ctx);
  const level = petLevelForXp(pet.xp);
  const wallet = economy.account(pet.guild_id, pet.owner_id).wallet;
  const checks = [
    { ok: level >= next.level, text: `Level ${next.level} (now ${level})` },
    ...next.items.map(({ item, quantity }) => {
      const owned = inventory.quantity(pet.guild_id, pet.owner_id, item);
      return { ok: owned >= quantity, text: `${itemLabel(item)} ×${quantity} (you have ${owned})` };
    }),
    { ok: wallet >= next.coins, text: `${formatCoins(next.coins)} (wallet ${formatCoins(wallet)})` },
  ];
  const ready = checks.every((c) => c.ok);
  const embed = kit.base({
    title: `🌟 Evolve ${displayName(pet)}?`,
    description: `**${stageName(pet)} → ${SPECIES[pet.species].stages[pet.stage]}**\nEvolving keeps its name, level, training and history, adds +3 to every stat${pet.stage === 1 ? ' and opens the back accessory slot' : ''}.\n\n${checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.text}`).join('\n')}`,
  });
  return {
    embeds: [embed],
    components: [row(button(cid('pet', 'evolveyes', pet.id), { label: ready ? 'Evolve' : 'Not ready yet', emoji: '🌟', style: ButtonStyle.Success, disabled: !ready }))],
  };
}

// ── Expeditions ────────────────────────────────────────────────────────

const lootEmojis = (destination) => DESTINATIONS[destination].loot.map(({ item }) => ITEMS[item].emoji).join('');

export function destinationLine(key) {
  const d = DESTINATIONS[key];
  return `${d.emoji} **${d.name}** · ${formatDuration(d.durationMs)} · level ${d.minLevel}+ · ${d.energy} energy · ${formatNumber(d.coins[0])}–${formatNumber(d.coins[1])} LC, ${d.xp} pet XP · finds ${lootEmojis(key)}`;
}

export function expeditionPanel(ctx, guildId, userId, now = Date.now()) {
  const { pets } = getServices(ctx);
  const kit = ctx.embeds.for(guildId);
  const active = pets.activeExpeditions(guildId, userId);
  const lines = active.map((e) => {
    const pet = pets.get(e.pet_id, now);
    const d = DESTINATIONS[e.destination];
    return `${petLabel(pet)} → ${d.emoji} ${d.name} · ${now >= e.ends_at ? '✅ **back!** Claim below.' : `back ${discordTimestamp(e.ends_at, 'R')}`}`;
  });
  const embed = kit.base({
    title: '🗺️ Expeditions',
    description: `${lines.join('\n') || 'No pets are away right now.'}\n\nUp to ${MAX_EXPEDITIONS} pets can be away at once. Pick a destination below to send your active pet, or use \`/pet expedition destination:\` to choose a pet.`,
  }).addFields({ name: 'Destinations', value: truncate(Object.keys(DESTINATIONS).map(destinationLine).join('\n'), 1024) });
  const components = [];
  const buttons = active.map((e) => {
    const pet = pets.get(e.pet_id, now);
    return now >= e.ends_at
      ? button(cid('pet', 'expclaim', e.id), { label: `Claim ${displayName(pet)}'s finds`, emoji: '🎁', style: ButtonStyle.Success })
      : button(cid('pet', 'exprecall', e.id), { label: `Recall ${displayName(pet)}`, emoji: '↩️', style: ButtonStyle.Danger });
  });
  if (buttons.length) components.push(row(...buttons));
  if (active.length < MAX_EXPEDITIONS) {
    components.push(row(select(cid('pet', 'expgo'), 'Send your active pet on an expedition', Object.entries(DESTINATIONS).map(([value, d]) => ({
      label: d.name, value, emoji: d.emoji, description: `${formatDuration(d.durationMs)} · level ${d.minLevel}+ · ${d.energy} energy`,
    })))));
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** The public message for one expedition: away, back (with a Claim button), claimed or recalled. */
export function expeditionPayload(ctx, expedition, { levels = null, progressionLines = [] } = {}, now = Date.now()) {
  const { pets } = getServices(ctx);
  const kit = ctx.embeds.for(expedition.guild_id);
  const pet = pets.get(expedition.pet_id, now);
  const d = DESTINATIONS[expedition.destination];
  const name = petLabel(pet);
  if (expedition.status === 'claimed') {
    const found = JSON.parse(expedition.rewards);
    const lines = [
      `${name} came home from ${d.emoji} **${d.name}** with:`,
      `• ${formatCoins(found.coins)}`,
      ...found.items.map((entry) => `• ${itemList([entry])}`),
      `• ${levels?.xp ?? found.xp} pet XP`,
      ...petLevelLines(pet, levels),
      ...progressionLines,
    ];
    return { content: null, embeds: [kit.success('Expedition complete', lines.join('\n'))], components: [], allowedMentions: { parse: [] } };
  }
  if (expedition.status === 'recalled') {
    return { content: null, embeds: [kit.info('Expedition recalled', `${name} came home early from ${d.emoji} ${d.name} and found nothing.`)], components: [], allowedMentions: { parse: [] } };
  }
  if (now >= expedition.ends_at) {
    return {
      embeds: [kit.base({ title: `🏡 ${displayName(pet)} is back!`, description: `${name} has returned from ${d.emoji} **${d.name}**. Claim what it found.` })],
      components: [row(button(cid('pet', 'expclaim', expedition.id), { label: 'Claim the finds', emoji: '🎁', style: ButtonStyle.Success }))],
      allowedMentions: { parse: [] },
    };
  }
  return {
    embeds: [kit.base({ title: `🧭 Off to ${d.name}`, description: `${name} set off for ${d.emoji} **${d.name}** and is back ${discordTimestamp(expedition.ends_at, 'R')}.\nThis message updates when it returns.` })],
    components: [row(button(cid('pet', 'exprecall', expedition.id), { label: 'Recall early (finds nothing)', emoji: '↩️', style: ButtonStyle.Danger }))],
    allowedMentions: { parse: [] },
  };
}

// ── Battles ────────────────────────────────────────────────────────────

const hpLine = (f) => `❤️ ${f.hp} / ${f.maxHp}\n${progressBar(f.hp, f.maxHp, 10)}${f.shield ? `\n🛡️ ${Math.round(f.shield * 100)}% block ready` : ''}${f.focus > 1 ? `\n🎯 next hit ×${f.focus}` : ''}`;

export function battlePayload(ctx, battle, { results = null } = {}) {
  const kit = ctx.embeds.for(battle.guild_id);
  const { pets } = getServices(ctx);
  const mentions = { parse: [] };

  if (battle.status === 'open') {
    const pet = pets.get(battle.host_pet_id);
    const embed = kit.base({
      title: '⚔️ Pet battle challenge',
      description: `<@${battle.host_id}>'s ${petLabel(pet)} (level ${petLevelForXp(pet.xp)}) challenges <@${battle.opponent_id}>!\nAccept with one of your pets before ${discordTimestamp(battle.expires_at, 'R')}.\nEach pet uses ${BATTLE.energy} energy. No coins are at stake.`,
    });
    return {
      embeds: [embed],
      components: [row(
        button(cid('petbattle', 'accept', battle.id), { label: 'Accept', emoji: '⚔️', style: ButtonStyle.Success }),
        button(cid('petbattle', 'decline', battle.id), { label: 'Decline', style: ButtonStyle.Secondary }),
        button(cid('petbattle', 'forfeit', battle.id), { label: 'Withdraw', style: ButtonStyle.Danger }),
      )],
      allowedMentions: mentions,
    };
  }
  if (battle.status === 'cancelled' || battle.status === 'expired') {
    const text = battle.status === 'expired' ? 'Nobody accepted the challenge in time.' : 'The challenge was withdrawn or declined.';
    return { content: null, embeds: [kit.info('Pet battle cancelled', text)], components: [], allowedMentions: mentions };
  }

  const { host, opponent } = battle.state.sides;
  const embed = kit.base({ title: `⚔️ ${host.emoji} ${host.name} vs ${opponent.emoji} ${opponent.name}` }).addFields(
    { name: `${host.emoji} ${host.name} · Lv ${host.level}`, value: `<@${battle.host_id}>\n${hpLine(host)}`, inline: true },
    { name: `${opponent.emoji} ${opponent.name} · Lv ${opponent.level}`, value: `<@${battle.opponent_id}>\n${hpLine(opponent)}`, inline: true },
  );
  const log = battle.state.log.join('\n');

  if (battle.status === 'finished') {
    const winner = battle.winner_id ? `🏆 <@${battle.winner_id}> wins!` : '🤝 It\'s a draw!';
    const rewardLines = results ? Object.values(results).map((r) => {
      const pet = battle.state.sides[r.side];
      if (!r.rewarded) return `${pet.emoji} ${pet.name}: no XP (daily battle reward limit reached)`;
      const levelUp = r.levels && r.levels.levelAfter > r.levels.levelBefore ? ` · 🎉 level ${r.levels.levelAfter}!` : '';
      return `${pet.emoji} ${pet.name}: +${r.levels?.xp ?? 0} pet XP${levelUp}`;
    }) : [];
    embed.setDescription(truncate(`${log}\n\n**${winner}**${rewardLines.length ? `\n${rewardLines.join('\n')}` : ''}`, 4096));
    return { content: null, embeds: [embed], components: [], allowedMentions: mentions };
  }

  const side = battle.state.turn;
  const moverId = side === 'host' ? battle.host_id : battle.opponent_id;
  const mover = battle.state.sides[side];
  embed.setDescription(truncate(`${log}\n\n**<@${moverId}>'s turn** with ${mover.emoji} ${mover.name} · ends ${discordTimestamp(battle.expires_at, 'R')}`, 4096));
  const moves = battleMoves(battle.state, side).map((m) => button(cid('petbattle', 'move', battle.id, m.key), {
    label: m.ready ? m.name : `${m.name} (${m.wait})`, emoji: m.emoji, style: m.key === 'attack' ? ButtonStyle.Primary : ButtonStyle.Secondary, disabled: !m.ready,
  }));
  return {
    content: null,
    embeds: [embed],
    components: [row(...moves.slice(0, 5)), row(button(cid('petbattle', 'forfeit', battle.id), { label: 'Forfeit', emoji: '🏳️', style: ButtonStyle.Danger }))],
    allowedMentions: mentions,
  };
}

export const petOptionLabel = (pet) => `${displayName(pet)} · ${speciesLabel(pet)} · Lv ${petLevelForXp(pet.xp)}`;
