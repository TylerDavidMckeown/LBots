import { defineBotConfig } from '@lyss/shared/botConfig.js';

export default defineBotConfig({
  name: 'ALYSS',
  namespace: 'ai',
  databaseFile: 'ai.db',
  brand: { footer: 'ALYSS • Lyss Tools' },
  intents: ['Guilds', 'GuildMessages', 'MessageContent'],
  status: [
    { type: 'Listening', text: 'your questions' },
    { type: 'Custom', text: 'Mention me to chat' },
  ],
  requiredPermissions: ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'ReadMessageHistory', 'EmbedLinks'],
  // Groq becomes required when the AI features land (build phase 12).
  optionalEnv: ['GUILD_ID', 'OWNER_ID', 'GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_FALLBACK_MODEL'],
  setup: [
    { key: 'ai.enabled', type: 'boolean', section: 'AI', label: 'AI responses enabled', default: true },
  ],
  help: { intro: 'ALYSS is the Lyss Tools AI assistant. Choose a category below.' },
});
