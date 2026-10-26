import autoroles from './autoroles.js';
import birthdays from './birthdays.js';
import boosts from './boosts.js';
import casino from './casino.js';
import duels from './duels.js';
import economy from './economy.js';
import economyAdmin from './economyAdmin.js';
import embedBuilder from './embedBuilder.js';
import games from './games.js';
import giveaways from './giveaways.js';
import maintenance from './maintenance.js';
import pets from './pets.js';
import polls from './polls.js';
import progression from './progression.js';
import puzzles from './puzzles.js';
import starboard from './starboard.js';
import suggestions from './suggestions.js';
import welcome from './welcome.js';
import work from './work.js';

/**
 * Every Lyss Community feature. Each module bundles its own commands, components,
 * events and jobs; the aggregator files in commands/, components/, events/ and jobs/
 * hand them to the shared loader.
 */
export default [
  autoroles, welcome, boosts, suggestions, giveaways, polls, starboard, birthdays, embedBuilder,
  economy, economyAdmin, work, games, casino, puzzles, duels, pets, progression, maintenance,
];
