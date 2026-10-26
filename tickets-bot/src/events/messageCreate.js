import { Events } from 'discord.js';
import { getServices } from '../services/index.js';

/** Any human message in an open ticket counts as activity and resets the inactivity reminder. */
export default {
  name: Events.MessageCreate,
  async execute(message, ctx) {
    if (!message.inGuild() || message.author.bot) return;
    getServices(ctx).tickets.touch(message.channelId);
  },
};
