import crypto from 'node:crypto';
import { UserError } from '@lyss/shared/errorReporter.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { NO_ACTIVITY } from './activity.js';
import {
  BATTLE, battleAct, forfeitBattle, startBattle, timeoutBattle,
} from './pets/battle.js';
import { energyCost } from './pets/rules.js';
import { secureRandom } from './random.js';

const DAY = 86_400_000;
const SIDES = ['host', 'opponent'];
/** Bit per side in pet_battles.rewarded: whether that player's battle counted for rewards. */
const REWARD_BIT = { host: 1, opponent: 2 };

/**
 * Pet battles between members. Every public method is one transaction:
 * - the challenger's pet is reserved when they challenge; the opponent's when they accept,
 * - only the player whose turn it is can move, and every status change is conditional,
 * - a battle finishes exactly once: XP, records and unlocking happen together,
 * - each member's battles only give rewards a limited number of times per day,
 *   so two members cannot farm XP by battling each other over and over.
 */
export function createPetBattleService(db, { pets, economy, activity = NO_ACTIVITY }) {
  const q = {
    insert: db.prepare(`
      INSERT INTO pet_battles (id, guild_id, host_id, opponent_id, host_pet_id, status, channel_id, created_at, expires_at)
      VALUES (@id, @guildId, @hostId, @opponentId, @hostPetId, 'open', @channelId, @now, @expiresAt)
    `),
    get: db.prepare('SELECT * FROM pet_battles WHERE id = ?'),
    hostOpen: db.prepare(`SELECT * FROM pet_battles WHERE guild_id = ? AND host_id = ? AND status IN ('open', 'active')`),
    activate: db.prepare(`
      UPDATE pet_battles SET status = 'active', opponent_pet_id = @petId, state = @state, started_at = @now, expires_at = @expiresAt
      WHERE id = @id AND status = 'open'
    `),
    saveState: db.prepare(`UPDATE pet_battles SET state = ?, expires_at = ? WHERE id = ? AND status = 'active'`),
    finish: db.prepare(`
      UPDATE pet_battles SET status = 'finished', state = @state, winner_id = @winnerId, rewarded = @rewarded, finished_at = @now
      WHERE id = @id AND status = 'active'
    `),
    close: db.prepare(`UPDATE pet_battles SET status = @status, finished_at = @now WHERE id = @id AND status = 'open'`),
    setMessage: db.prepare('UPDATE pet_battles SET channel_id = ?, message_id = ? WHERE id = ?'),
    due: db.prepare(`SELECT id FROM pet_battles WHERE status IN ('open', 'active') AND expires_at <= ? ORDER BY expires_at LIMIT 200`),
    memberBattles: db.prepare(`SELECT id FROM pet_battles WHERE guild_id = ? AND status IN ('open', 'active') AND (host_id = ? OR opponent_id = ?)`),
    rewardedToday: db.prepare(`
      SELECT COUNT(*) AS n FROM pet_battles WHERE guild_id = @guildId AND status = 'finished' AND finished_at > @since
        AND ((host_id = @userId AND (rewarded & 1) != 0) OR (opponent_id = @userId AND (rewarded & 2) != 0))
    `),
    prune: db.prepare(`DELETE FROM pet_battles WHERE status IN ('finished', 'cancelled', 'expired') AND finished_at < ?`),
  };

  const tx = (fn) => db.transaction(fn).immediate();
  const parse = (row) => row && { ...row, state: row.state ? JSON.parse(row.state) : null };
  const load = (id) => parse(q.get.get(id));
  const fail = (message, title) => {
    throw new UserError(message, { title });
  };
  const sideOf = (battle, userId) => (battle.host_id === userId ? 'host' : battle.opponent_id === userId ? 'opponent' : null);
  const petOf = (battle, side) => (side === 'host' ? battle.host_pet_id : battle.opponent_pet_id);
  const userOf = (battle, side) => (side === 'host' ? battle.host_id : battle.opponent_id);

  /** Settles a finished battle exactly once. `state.winner` is a side, or null for a draw. */
  function finish(battle, state, now, settings) {
    const winnerSide = state.winner ?? null;
    const sides = SIDES.map((side) => {
      const userId = userOf(battle, side);
      const rewarded = q.rewardedToday.get({ guildId: battle.guild_id, userId, since: now - DAY }).n < BATTLE.rewardLimit;
      const result = !winnerSide ? 'draw' : side === winnerSide ? 'win' : 'loss';
      return { side, userId, result, rewarded };
    });
    const rewardedBits = sides.reduce((bits, s) => bits | (s.rewarded ? REWARD_BIT[s.side] : 0), 0);
    const winnerId = winnerSide ? userOf(battle, winnerSide) : null;
    if (!q.finish.run({ id: battle.id, state: JSON.stringify(state), winnerId, rewarded: rewardedBits, now }).changes) {
      fail('This battle is already over.', 'Battle over');
    }
    const results = {};
    for (const s of sides) {
      const finished = pets.finishBattle({ petId: petOf(battle, s.side), result: s.result, xp: s.rewarded ? BATTLE.xp[s.result] : 0, now, settings });
      const progression = s.result === 'win' && s.rewarded
        ? activity.emit({ guildId: battle.guild_id, userId: s.userId, activity: 'pet_battle_won', operationKey: `petbattle:${battle.id}`, now, settings }).progression ?? null
        : null;
      results[s.side] = { ...s, levels: finished?.levels ?? null, progression };
    }
    return { battle: load(battle.id), results, winnerId };
  }

  /** Closes an unanswered challenge and unlocks the challenger's pet. */
  function close(battle, status, now) {
    if (!q.close.run({ id: battle.id, status, now }).changes) fail('This challenge is no longer open.', 'Challenge closed');
    pets.unreserve(battle.host_pet_id, now);
    return { battle: load(battle.id), results: null };
  }

  /** Time ran out: an open challenge expires; in a battle, the player to move forfeits. */
  function expire(battle, now, settings) {
    if (battle.status === 'open') return close(battle, 'expired', now);
    return { ...finish(battle, timeoutBattle(battle.state), now, settings), timedOut: true };
  }

  return {
    get: load,
    setMessage: (id, channelId, messageId) => q.setMessage.run(channelId, messageId, id),
    /** A member's pets that could battle right now. */
    eligiblePets: (guildId, userId, now = Date.now()) => pets.forOwner(guildId, userId, now)
      .filter((pet) => pet.status === 'idle' && pet.energy >= energyCost(pet, BATTLE.energy)),

    /** Challenges another member. The challenger's pet is reserved until the battle ends. */
    challenge({ guildId, hostId, opponentId, petId = null, now = Date.now(), channelId = null, settings }) {
      if (hostId === opponentId) fail('You cannot battle yourself.', 'Invalid opponent');
      return tx(() => {
        const readyAt = economy.cooldown(guildId, hostId, 'pet:battle');
        if (readyAt > now) fail(`You can start another pet battle ${discordTimestamp(readyAt, 'R')}.`, 'Slow down');
        const existing = parse(q.hostOpen.get(guildId, hostId));
        if (existing && existing.expires_at <= now) expire(existing, now, settings);
        else if (existing) fail(`You already have a pet battle going. It ends ${discordTimestamp(existing.expires_at, 'R')} if nobody moves.`, 'Battle in progress');
        if (!pets.forOwner(guildId, opponentId, now).length) fail(`<@${opponentId}> does not have a pet yet.`, 'No pet');
        const pet = pets.reserveForBattle({ guildId, userId: hostId, petId, energy: BATTLE.energy, now });
        const id = crypto.randomUUID();
        q.insert.run({ id, guildId, hostId, opponentId, hostPetId: pet.id, channelId, now, expiresAt: now + BATTLE.challengeMs });
        economy.setCooldown(guildId, hostId, 'pet:battle', now + BATTLE.cooldownMs);
        return load(id);
      });
    },

    /** The opponent accepts with one of their pets. Both pets pay the energy cost and the battle starts. */
    accept({ battleId, userId, petId = null, now = Date.now() }) {
      return tx(() => {
        const battle = load(battleId);
        if (!battle) fail('This battle no longer exists.', 'This has expired');
        if (battle.opponent_id !== userId) fail('This challenge is not for you.', 'Not your battle');
        if (battle.status !== 'open') fail('This challenge is no longer open.', 'Challenge closed');
        if (now > battle.expires_at) fail('This challenge has expired.', 'This has expired');
        const opponentPet = pets.reserveForBattle({ guildId: battle.guild_id, userId, petId, energy: BATTLE.energy, now });
        const hostPet = pets.chargeBattle(battle.host_pet_id, BATTLE.energy, now);
        pets.chargeBattle(opponentPet.id, BATTLE.energy, now);
        const state = startBattle(hostPet, opponentPet);
        q.activate.run({ id: battle.id, petId: opponentPet.id, state: JSON.stringify(state), now, expiresAt: now + BATTLE.turnMs });
        return load(battle.id);
      });
    },

    /** One move by the player whose turn it is. */
    act({ battleId, userId, move, now = Date.now(), settings, rng = secureRandom }) {
      return tx(() => {
        const battle = load(battleId);
        if (!battle) fail('This battle no longer exists.', 'This has expired');
        const side = sideOf(battle, userId);
        if (!side) fail('This is not your battle.', 'Not your battle');
        if (battle.status !== 'active') fail(battle.status === 'open' ? 'The battle has not started yet.' : 'This battle is over.', 'Battle over');
        if (now > battle.expires_at) return expire(battle, now, settings);
        const step = battleAct(battle.state, side, move, { rng });
        if (step.invalid) fail(step.feedback, 'Not allowed');
        if (step.done) return { ...finish(battle, step.state, now, settings), feedback: step.feedback };
        q.saveState.run(JSON.stringify(step.state), now + BATTLE.turnMs, battle.id);
        return { battle: load(battle.id), results: null, feedback: step.feedback };
      });
    },

    /** Either player gives up a running battle; the challenger can also withdraw an open one. */
    forfeit({ battleId, userId, now = Date.now(), settings }) {
      return tx(() => {
        const battle = load(battleId);
        const side = battle && sideOf(battle, userId);
        if (!side) fail('This is not your battle.', 'Not your battle');
        if (battle.status === 'open') return close(battle, 'cancelled', now);
        if (battle.status !== 'active') fail('This battle is over.', 'Battle over');
        return finish(battle, forfeitBattle(battle.state, side), now, settings);
      });
    },

    /** The opponent declines a challenge. */
    decline({ battleId, userId, now = Date.now() }) {
      return tx(() => {
        const battle = load(battleId);
        if (!battle || battle.opponent_id !== userId) fail('This challenge is not for you.', 'Not your battle');
        return close(battle, 'cancelled', now);
      });
    },

    /** Applies expiry to every overdue battle, each in its own transaction. */
    expireDue(now, settingsFor) {
      const results = [];
      for (const { id } of q.due.all(now)) {
        try {
          const result = tx(() => {
            const battle = load(id);
            if (!battle || !['open', 'active'].includes(battle.status) || battle.expires_at > now) return null;
            return expire(battle, now, settingsFor(battle.guild_id));
          });
          if (result) results.push(result);
        } catch (error) {
          results.push({ id, error });
        }
      }
      return results;
    },

    /** A member left the server: their challenges close and their running battles are forfeited. */
    cancelForMember({ guildId, userId, now = Date.now(), settings }) {
      return q.memberBattles.all(guildId, userId, userId).map(({ id }) => tx(() => {
        const battle = load(id);
        if (!battle) return null;
        if (battle.status === 'open') return close(battle, 'cancelled', now);
        if (battle.status === 'active') return finish(battle, forfeitBattle(battle.state, sideOf(battle, userId), 'left the server'), now, settings);
        return null;
      })).filter(Boolean);
    },

    prune: (before) => q.prune.run(before).changes,
  };
}
