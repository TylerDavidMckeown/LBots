import path from 'node:path';
import { createHelpCommand } from './helpCommand.js';
import { createSetupCommand } from './setupKit.js';
import { createStatusCommand } from './statusCommand.js';
import { loadCommands, loadComponents, mergeByKey, validateCommand, validateComponent } from './loader.js';

/** /help, /status and /setup, which every bot provides. */
export function createBuiltins(config) {
  const help = createHelpCommand(config);
  return {
    commands: [help.command, createStatusCommand(config), createSetupCommand(config)].map((value) => ({ file: 'builtin', value: validateCommand(value) })),
    components: help.components.map((value) => ({ file: 'builtin', value: validateComponent(value) })),
  };
}

/**
 * Loads a bot's commands and components, layered over the shared built-ins.
 * A bot file with the same command name or component id replaces the built-in.
 */
export async function collectModules(rootDir, config) {
  const builtins = createBuiltins(config);
  const src = path.join(rootDir, 'src');
  const commands = mergeByKey([builtins.commands, await loadCommands(path.join(src, 'commands'))], (c) => c.data.name);
  const components = mergeByKey([builtins.components, await loadComponents(path.join(src, 'components'))], (c) => c.id);
  return { commands, components };
}
