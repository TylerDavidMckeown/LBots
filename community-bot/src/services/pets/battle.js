import { ABILITIES, SPECIES } from './catalogue.js';
import { displayName, hasTrait, petLevelForXp, petStats, unlockedAbilities } from './rules.js';

/**
 * Turn-based pet battles: a pure state machine, run by petBattleService.
 * Both pets are snapshotted when the battle starts, so nothing outside the battle can
 * change it. Each turn the pet whose turn it is attacks, guards or uses an ability.
 */

export const BATTLE = Object.freeze({
  energy: 15,
  challengeMs: 2 * 60_000,
  turnMs: 60_000,
  maxTurns: 30,
  cooldownMs: 2 * 60_000,
  /** Battles that give rewards, per member, in any 24 hours. Further battles are just for fun. */
  rewardLimit: 10,
  xp: { win: 40, loss: 20, draw: 25 },
  guardBlock: 0.5,
  guardHeal: 0.08,
  critMultiplier: 1.5,
});

export const BASIC_MOVES = Object.freeze({
  attack: { name: 'Attack', emoji: '⚔️' },
  guard: { name: 'Guard', emoji: '🛡️' },
});

const other = (side) => (side === 'host' ? 'opponent' : 'host');
const invalid = (state, feedback) => ({ state, feedback, invalid: true });

export function fighter(pet) {
  const stats = petStats(pet);
  const maxHp = Math.round((20 + stats.vitality * 3) * (hasTrait(pet, 'sturdy') ? 1.1 : 1));
  return {
    petId: pet.id, name: displayName(pet), emoji: SPECIES[pet.species].emoji, level: petLevelForXp(pet.xp), stats, maxHp, hp: maxHp,
    brave: hasTrait(pet, 'brave'), abilities: unlockedAbilities(pet), cooldowns: {}, shield: 0, focus: 1,
  };
}

/** The faster pet moves first; the challenger wins ties. */
export function startBattle(hostPet, opponentPet) {
  const sides = { host: fighter(hostPet), opponent: fighter(opponentPet) };
  const turn = sides.opponent.stats.agility > sides.host.stats.agility ? 'opponent' : 'host';
  return { sides, turn, turns: 0, winner: undefined, log: [`${sides[turn].emoji} **${sides[turn].name}** is faster and moves first.`] };
}

export const critChance = (agility) => Math.min(0.2, 0.05 + agility * 0.0015);

/** Damage from `attacker` to `defender`. A pierce ignores half the guard stat and any shield. */
export function damageRoll(attacker, defender, power, rng, pierce = false) {
  const guard = pierce ? defender.stats.guard / 2 : defender.stats.guard;
  const crit = rng() < critChance(attacker.stats.agility);
  const variance = 0.9 + rng() * 0.2;
  let amount = (4 + attacker.stats.power * 1.5) * power * attacker.focus * (40 / (40 + guard)) * variance
    * (attacker.brave ? 1.08 : 1) * (crit ? BATTLE.critMultiplier : 1);
  const blocked = !pierce && defender.shield > 0;
  if (blocked) amount *= 1 - defender.shield;
  return { amount: Math.max(1, Math.round(amount)), crit, blocked };
}

/** The moves for `side` right now: attack, guard and unlocked abilities (with cooldowns). */
export function battleMoves(state, side) {
  const me = state.sides[side];
  return [
    { key: 'attack', ...BASIC_MOVES.attack, ready: true },
    { key: 'guard', ...BASIC_MOVES.guard, ready: true },
    ...me.abilities.map((key) => ({ key, name: ABILITIES[key].name, emoji: ABILITIES[key].emoji, ready: !me.cooldowns[key], wait: me.cooldowns[key] ?? 0 })),
  ];
}

function hit(state, side, power, rng, { pierce = false } = {}) {
  const me = state.sides[side];
  const them = state.sides[other(side)];
  const roll = damageRoll(me, them, power, rng, pierce);
  them.hp = Math.max(0, them.hp - roll.amount);
  if (!pierce) them.shield = 0;
  me.focus = 1;
  const notes = [roll.crit ? 'critical hit!' : null, roll.blocked ? 'partly blocked' : null].filter(Boolean);
  return { amount: roll.amount, text: `dealt **${roll.amount}** damage${notes.length ? ` (${notes.join(', ')})` : ''}` };
}

function heal(me, amount) {
  const before = me.hp;
  me.hp = Math.min(me.maxHp, me.hp + Math.max(1, Math.round(amount)));
  return me.hp - before;
}

/** Winner after the turn limit: the higher share of health remaining, or a draw. */
function onPoints(state) {
  const share = (side) => state.sides[side].hp / state.sides[side].maxHp;
  const diff = share('host') - share('opponent');
  return Math.abs(diff) < 1e-9 ? null : diff > 0 ? 'host' : 'opponent';
}

/**
 * Applies one move for `side`. Returns { state, feedback, done } or { invalid: true }.
 * `state.winner` is 'host', 'opponent' or null (a draw) once the battle is over.
 */
export function battleAct(input, side, move, { rng }) {
  const state = structuredClone(input);
  if (state.winner !== undefined) return invalid(state, 'This battle is over.');
  if (state.turn !== side) return invalid(state, 'It is not your turn.');
  const me = state.sides[side];
  const them = state.sides[other(side)];
  const ability = ABILITIES[move];
  if (!BASIC_MOVES[move] && !(ability && me.abilities.includes(move))) return invalid(state, 'Your pet does not know that move.');
  if (ability && me.cooldowns[move]) return invalid(state, `${ability.name} is recharging for ${me.cooldowns[move]} more turn${me.cooldowns[move] === 1 ? '' : 's'}.`);

  // Cooldowns count this pet's own turns.
  for (const key of Object.keys(me.cooldowns)) {
    me.cooldowns[key] -= 1;
    if (me.cooldowns[key] <= 0) delete me.cooldowns[key];
  }

  let line;
  const who = `${me.emoji} **${me.name}**`;
  if (move === 'attack') {
    line = `${who} attacked and ${hit(state, side, 1, rng).text}.`;
  } else if (move === 'guard') {
    me.shield = Math.max(me.shield, BATTLE.guardBlock);
    const healed = heal(me, me.maxHp * BATTLE.guardHeal);
    line = `${who} raised its guard${healed ? ` and recovered **${healed}** health` : ''}.`;
  } else {
    const name = `${ability.emoji} ${ability.name}`;
    me.cooldowns[move] = ability.cooldown;
    switch (ability.kind) {
      case 'strike':
        line = `${who} used ${name} and ${hit(state, side, ability.power, rng).text}.`;
        break;
      case 'pierce':
        line = `${who} used ${name}, pierced the defences and ${hit(state, side, ability.power, rng, { pierce: true }).text}.`;
        break;
      case 'drain': {
        const dealt = hit(state, side, ability.power, rng);
        const healed = heal(me, dealt.amount * ability.heal);
        line = `${who} used ${name}, ${dealt.text} and recovered **${healed}** health.`;
        break;
      }
      case 'heal':
        line = `${who} used ${name} and recovered **${heal(me, me.maxHp * ability.heal)}** health.`;
        break;
      case 'shield':
        me.shield = ability.block;
        line = `${who} used ${name}. The next hit will be ${Math.round(ability.block * 100)}% blocked.`;
        break;
      case 'focus':
        me.focus = ability.boost;
        line = `${who} used ${name}. Its next attack deals ×${ability.boost} damage.`;
        break;
      default:
        throw new Error(`Unknown ability kind ${ability.kind}`);
    }
  }

  state.turns += 1;
  state.log = [...state.log, line].slice(-4);
  if (them.hp <= 0) {
    state.winner = side;
    state.log = [...state.log, `${them.emoji} **${them.name}** is out of energy. ${who} wins!`].slice(-4);
    return { state, feedback: line, done: true };
  }
  if (state.turns >= BATTLE.maxTurns) {
    state.winner = onPoints(state);
    const result = state.winner ? `${state.sides[state.winner].emoji} **${state.sides[state.winner].name}** wins on health.` : 'It\'s a draw!';
    state.log = [...state.log, `${BATTLE.maxTurns} turns are up. ${result}`].slice(-4);
    return { state, feedback: line, done: true };
  }
  state.turn = other(side);
  return { state, feedback: line, done: false };
}

/** `side` gives up (or runs out of time): the other side wins. */
export function forfeitBattle(input, side, reason = 'forfeited') {
  const state = structuredClone(input);
  const me = state.sides[side];
  state.winner = other(side);
  state.log = [...state.log, `${me.emoji} **${me.name}** ${reason}.`].slice(-4);
  return state;
}

/** Time ran out: the pet whose turn it was forfeits. */
export const timeoutBattle = (state) => forfeitBattle(state, state.turn, 'ran out of time');
