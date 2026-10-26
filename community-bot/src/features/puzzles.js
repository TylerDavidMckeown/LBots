import { SlashCommandBuilder } from 'discord.js';
import { DIFFICULTIES, GAMES } from '../services/games/catalogue.js';
import { TRIVIA_CATEGORIES } from '../services/games/data/trivia.js';
import { present } from './games.js';

/** Free puzzle, reaction and adventure games. Rewards are in services/games/tables.js. */

const DIFFICULTY_CHOICES = Object.entries(DIFFICULTIES).map(([value, name]) => ({ name, value }));
const difficultyOption = (description = 'Difficulty (easy if empty)') => (o) => o.setName('difficulty').setDescription(description).addChoices(...DIFFICULTY_CHOICES);

/** A free game with an optional difficulty. */
function freeGame(key, { difficulty = false } = {}) {
  const data = new SlashCommandBuilder().setName(key).setDescription(`${GAMES[key].name}: ${GAMES[key].rules}`.slice(0, 100));
  if (difficulty) data.addStringOption(difficultyOption());
  return {
    data,
    category: 'Games',
    tier: 'member',
    execute: (interaction, ctx) => present(interaction, ctx, key, 0, difficulty ? { difficulty: interaction.options.getString('difficulty') ?? 'easy' } : {}),
  };
}

const trivia = {
  data: new SlashCommandBuilder().setName('trivia').setDescription('Answer a trivia question for coins and XP')
    .addStringOption((o) => o.setName('category').setDescription('Question category (any if empty)')
      .addChoices(...Object.entries(TRIVIA_CATEGORIES).map(([value, c]) => ({ name: c.label, value }))))
    .addStringOption(difficultyOption('Difficulty (any if empty)')),
  category: 'Games',
  tier: 'member',
  execute: (interaction, ctx) => present(interaction, ctx, 'trivia', 0, {
    category: interaction.options.getString('category'),
    difficulty: interaction.options.getString('difficulty'),
  }),
};

export default {
  commands: [
    trivia,
    freeGame('quickmath', { difficulty: true }),
    freeGame('guess', { difficulty: true }),
    freeGame('wordguess'),
    freeGame('memory', { difficulty: true }),
    freeGame('pattern', { difficulty: true }),
    freeGame('unscramble', { difficulty: true }),
    freeGame('reaction'),
    freeGame('fish'),
    freeGame('treasure'),
  ],
};
