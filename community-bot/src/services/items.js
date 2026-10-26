/**
 * Item catalogue: everything that can sit in a member's inventory. Pets, expeditions,
 * jobs and level rewards grant these; the shop (phase 9) will sell them.
 * Keys are stored in the database, so never rename one.
 */

export const RARITIES = Object.freeze({
  common: { label: 'Common', emoji: '⚪', order: 1 },
  uncommon: { label: 'Uncommon', emoji: '🟢', order: 2 },
  rare: { label: 'Rare', emoji: '🔵', order: 3 },
  epic: { label: 'Epic', emoji: '🟣', order: 4 },
  legendary: { label: 'Legendary', emoji: '🟠', order: 5 },
  mythic: { label: 'Mythic', emoji: '🔴', order: 6 },
});

export const rarityLabel = (rarity) => `${RARITIES[rarity].emoji} ${RARITIES[rarity].label}`;

export const ITEM_KINDS = Object.freeze({
  food: { label: 'Pet food', emoji: '🍖' },
  material: { label: 'Evolution materials', emoji: '💠' },
  egg: { label: 'Pet eggs', emoji: '🥚' },
  pet_cosmetic: { label: 'Pet accessories', emoji: '🎀' },
  collectible: { label: 'Collectibles', emoji: '🏺' },
});

/** Where an accessory is worn, and when the slot opens. */
export const COSMETIC_SLOTS = Object.freeze({
  head: { label: 'Head', unlock: { level: 1 }, unlockText: 'from the start' },
  neck: { label: 'Neck', unlock: { level: 10 }, unlockText: 'at pet level 10' },
  back: { label: 'Back', unlock: { stage: 2 }, unlockText: 'after the first evolution' },
});

const food = (name, emoji, rarity, effect, description) => ({ name, emoji, kind: 'food', rarity, food: effect, description });
const collectible = (name, emoji, rarity, description) => ({ name, emoji, kind: 'collectible', rarity, description });
const accessory = (name, emoji, rarity, slot) => ({ name, emoji, kind: 'pet_cosmetic', rarity, slot, description: `A ${COSMETIC_SLOTS[slot].label.toLowerCase()} accessory for your pet. Purely cosmetic.` });

export const ITEMS = Object.freeze({
  // Food. `food` lists what one serving adds (happiness, energy, pet XP).
  berry_treat: food('Berry Treat', '🍓', 'common', { happiness: 20, xp: 10 }, 'A sweet snack pets love.'),
  pet_treat: food('Pet Treat', '🦴', 'common', { happiness: 10, xp: 40 }, 'A training treat full of pet XP. Earned as a Pet Caretaker.'),
  energy_herb: food('Energy Herb', '🌿', 'common', { happiness: 5, energy: 30 }, 'Restores energy.'),
  frost_fish: food('Frost Fish', '🐟', 'uncommon', { happiness: 20, energy: 15, xp: 30 }, 'A chilly delicacy from the Frozen Mountains.'),
  golden_apple: food('Golden Apple', '🍎', 'rare', { happiness: 30, energy: 25, xp: 80 }, 'A rare, glowing fruit.'),

  // Evolution materials.
  evo_crystal: { name: 'Evolution Crystal', emoji: '💠', kind: 'material', rarity: 'rare', description: 'Needed for a pet\'s first evolution.' },
  star_shard: { name: 'Star Shard', emoji: '🌠', kind: 'material', rarity: 'epic', description: 'Needed for a pet\'s final evolution.' },

  // Eggs hatch with /pet adopt. Their odds are in pets/catalogue.js and shown before hatching.
  mystery_egg: { name: 'Mystery Egg', emoji: '🥚', kind: 'egg', rarity: 'rare', description: 'Hatches into a random pet of any rarity.' },
  dragon_egg: { name: 'Dragon Egg', emoji: '🔥', kind: 'egg', rarity: 'legendary', description: 'Warm to the touch. Hatches into a fire pet.' },
  celestial_egg: { name: 'Celestial Egg', emoji: '🌌', kind: 'egg', rarity: 'mythic', description: 'Shimmers with starlight. Hatches into a sky pet.' },

  // Accessories.
  party_hat: accessory('Party Hat', '🎉', 'common', 'head'),
  flower_crown: accessory('Flower Crown', '🌸', 'uncommon', 'head'),
  wizard_hat: accessory('Wizard Hat', '🧙', 'rare', 'head'),
  golden_crown: accessory('Golden Crown', '👑', 'legendary', 'head'),
  bow_tie: accessory('Bow Tie', '🎀', 'common', 'neck'),
  explorer_scarf: accessory('Explorer Scarf', '🧣', 'uncommon', 'neck'),
  star_collar: accessory('Star Collar', '⭐', 'rare', 'neck'),
  tiny_cape: accessory('Tiny Cape', '🦸', 'uncommon', 'back'),
  fairy_wings: accessory('Fairy Wings', '✨', 'epic', 'back'),
  dragon_wings: accessory('Dragon Wings', '🐲', 'legendary', 'back'),

  // Collectibles found on expeditions.
  acorn_charm: collectible('Acorn Charm', '🌰', 'common', 'A lucky charm from the Enchanted Forest.'),
  snow_globe: collectible('Snow Globe', '🔮', 'uncommon', 'A souvenir from the Frozen Mountains.'),
  puzzle_fragment: collectible('Puzzle Fragment', '🧩', 'uncommon', 'A carved fragment from the Ancient Ruins.'),
  ancient_relic: collectible('Ancient Relic', '🏺', 'rare', 'A relic from the Ancient Ruins.'),
  dragon_scale: collectible('Dragon Scale', '🛡️', 'rare', 'A shed scale from the Dragon\'s Lair.'),
  stardust_jar: collectible('Stardust Jar', '🫙', 'epic', 'Stardust gathered in Starfall Valley.'),
});

export const itemLabel = (key) => `${ITEMS[key].emoji} ${ITEMS[key].name}`;
export const itemsOfKind = (kind) => Object.keys(ITEMS).filter((key) => ITEMS[key].kind === kind);

/** "🍓 Berry Treat ×2, 💠 Evolution Crystal" from [{ item, quantity }]. */
export function itemList(entries) {
  return entries.map(({ item, quantity }) => `${itemLabel(item)}${quantity > 1 ? ` ×${quantity}` : ''}`).join(', ');
}
