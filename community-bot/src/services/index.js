import { createActivityHub } from './activity.js';
import {
  createAutoroleStore, createBirthdayStore, createBoostStore, createEmbedStore, createGiveawayStore,
  createPollStore, createStarboardStore, createSuggestionStore,
} from './communityStores.js';
import { economySettings } from './economyRules.js';
import { createEconomyService } from './economyService.js';
import { createGameService } from './gameService.js';
import { createInventoryService } from './inventoryService.js';
import { createJobService } from './jobService.js';
import { createPetBattleService } from './petBattleService.js';
import { createPetService } from './petService.js';
import { createProgressionService } from './progressionService.js';

const cache = new WeakMap();

/** Builds the game services around one activity hub, so every activity reaches progression. */
export function createGameWorld(db) {
  const activity = createActivityHub();
  const economy = createEconomyService(db, { activity });
  const inventory = createInventoryService(db);
  const progression = createProgressionService(db, { economy, inventory });
  activity.on('progression', progression.onActivity);
  const jobs = createJobService(db, economy, { inventory, activity });
  const pets = createPetService(db, { economy, inventory, progression, activity });
  return {
    activity,
    economy,
    inventory,
    progression,
    jobs,
    pets,
    petBattles: createPetBattleService(db, { pets, economy, activity }),
    games: createGameService(db, economy, jobs, { pets, inventory, activity }),
  };
}

/** Services bound to this bot's database, created once per process. */
export function getServices(ctx) {
  let services = cache.get(ctx.db);
  if (!services) {
    services = {
      autoroles: createAutoroleStore(ctx.db),
      boosts: createBoostStore(ctx.db),
      suggestions: createSuggestionStore(ctx.db),
      giveaways: createGiveawayStore(ctx.db),
      polls: createPollStore(ctx.db),
      starboard: createStarboardStore(ctx.db),
      birthdays: createBirthdayStore(ctx.db),
      embeds: createEmbedStore(ctx.db),
      ...createGameWorld(ctx.db),
    };
    cache.set(ctx.db, services);
  }
  return services;
}

/** Economy settings for a guild (defaults overridden by /economy admin config). */
export const settingsFor = (ctx, guildId) => economySettings(ctx.guildConfig, guildId);
