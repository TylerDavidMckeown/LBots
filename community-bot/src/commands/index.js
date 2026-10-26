// Collects the commands from every feature module (see features/index.js).
import features from '../features/index.js';

export default features.flatMap((feature) => feature.commands ?? []);
