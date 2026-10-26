import { SlashCommandBuilder } from 'discord.js';
import { reviewsPage } from '../embeds/commissionEmbeds.js';
import { getServices } from '../services/index.js';

export default {
  data: new SlashCommandBuilder().setName('reviews').setDescription('Read reviews from commission clients'),
  category: 'Commissions',
  tier: 'restricted',
  cooldown: 5,
  async execute(interaction, ctx) {
    return interaction.reply(reviewsPage(ctx, interaction.guildId, 1, getServices(ctx)));
  },
};
