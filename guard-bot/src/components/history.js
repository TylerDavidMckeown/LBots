import { historyPage } from '../embeds/caseEmbeds.js';
import { getServices } from '../services/index.js';

export default {
  id: 'history:page',
  tier: 'moderator',
  async execute(interaction, ctx, [userId, page]) {
    await interaction.update(historyPage(ctx, interaction.guildId, userId, Number(page), getServices(ctx)));
  },
};
