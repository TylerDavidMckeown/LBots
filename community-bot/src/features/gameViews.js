import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { truncate } from '@lyss/shared/utils/text.js';
import { discordTimestamp } from '@lyss/shared/utils/time.js';
import { formatCoins } from '../services/economyRules.js';
import { LOOT } from '../services/games/adventure.js';
import { handValue, hlChance, hlMultiplierAfter, rouletteColour, total } from '../services/games/casino.js';
import { DIFFICULTIES, GAMES, isFreePlay } from '../services/games/catalogue.js';
import { TRIVIA_CATEGORIES } from '../services/games/data/trivia.js';
import { RPS_CHOICES } from '../services/games/duels.js';
import { REACTION, WORDGUESS_TRIES } from '../services/games/puzzles.js';
import { HIGHER_LOWER, ROULETTE_BETS } from '../services/games/tables.js';
import { cid, rowsOf } from './common.js';

/** Rendering for game sessions: confirmation cards, live games, results and duels. */

const DIE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const COLOUR_DOT = { red: '🔴', black: '⚫', green: '🟢' };
const MARK = { hit: '🟩', near: '🟨', miss: '⬛' };
const HINT = (distance) => (distance === 1 ? '🔥' : distance === 2 ? '🌡️' : '❄️');

/** Games whose result is revealed after a short "spinning" frame. */
export const ANIMATED = new Set(['coinflip', 'dice', 'slots', 'roulette', 'duel-coinflip', 'duel-dice']);

export function button(customId, { label, emoji, style = ButtonStyle.Secondary, disabled = false } = {}) {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(truncate(label, 80));
  if (emoji) b.setEmoji(emoji);
  return b;
}
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const rows = (buttons, size = 5) => rowsOf(buttons, size).map((chunk) => row(...chunk));
const act = (session, action) => cid('game', 'act', session.id, action);
const dice = (values) => `${values.map((d) => DIE[d - 1]).join(' ')} = **${total(values)}**`;
const cards = (list) => list.map((card) => `\`${card}\``).join(' ');
const rpsEmoji = (choice) => RPS_CHOICES[choice].emoji;
const rpsButtons = (customIdFor) => Object.entries(RPS_CHOICES).map(([key, c]) => button(customIdFor(key), { label: c.label, emoji: c.emoji, style: ButtonStyle.Primary }));
const difficultyText = (difficulty) => (difficulty ? ` · ${DIFFICULTIES[difficulty]}` : '');

// ── Per-game screens ───────────────────────────────────────────────────────
// Each returns { lines, rows, quit } for the session's current state. `quit: false`
// means the game supplies its own controls instead of the standard Quit button.

const SCREENS = {
  coinflip: ({ state }) => ({ lines: [`🪙 The coin landed on **${state.side}**. You called ${state.choice}.`] }),
  dice: ({ state }) => ({ lines: [`**You:** ${dice(state.player)}`, `**Bot:** ${dice(state.bot)}`] }),
  slots: ({ state }) => ({ lines: [`**[ ${state.reels.join(' | ')} ]**`, state.multiplier ? `Pays ×${state.multiplier}` : 'No match.'] }),
  roulette: ({ state }) => ({
    lines: [
      `The ball landed on ${COLOUR_DOT[rouletteColour(state.result)]} **${state.result}**.`,
      `Your bet: ${ROULETTE_BETS[state.bet].label}${state.bet === 'number' ? ` ${state.number}` : ''}`,
    ],
  }),

  blackjack(session, { active }) {
    const { state } = session;
    const lines = [
      `**Your hand** (${handValue(state.player).total}): ${cards(state.player)}`,
      active
        ? `**Dealer** (${handValue(state.dealer.slice(0, 1)).total} + ?): ${cards(state.dealer.slice(0, 1))} \`??\``
        : `**Dealer** (${handValue(state.dealer).total}): ${cards(state.dealer)}`,
    ];
    if (state.doubled) lines.push('You doubled down.');
    const canDouble = state.player.length === 2 && !state.doubled;
    return {
      lines,
      rows: active ? [row(
        button(act(session, 'hit'), { label: 'Hit', emoji: '➕', style: ButtonStyle.Primary }),
        button(act(session, 'stand'), { label: 'Stand', emoji: '✋', style: ButtonStyle.Success }),
        ...(canDouble ? [button(act(session, 'double'), { label: `Double (+${formatCoins(state.baseStake)})`, emoji: '⏫' })] : []),
      )] : [],
    };
  },

  higherlower(session, { active }) {
    const { state } = session;
    const lines = [`Current number: **${state.current}** (from ${HIGHER_LOWER.min} to ${HIGHER_LOWER.max})`, `Streak: **${state.streak}** / ${HIGHER_LOWER.maxRounds}`];
    if (!state.free && state.streak > 0) lines.push(`Multiplier ×${state.multiplier}: cashing out now pays **${formatCoins(Math.floor(state.stake * state.multiplier))}**`);
    if (state.free && state.streak > 0) lines.push(`Earned so far: ${formatCoins(state.streak * HIGHER_LOWER.freeCoinsPerRound)}`);
    const history = state.history.slice(-5).map((h) => `${h.from} → ${h.to} ${h.correct ? '✅' : '❌'}`);
    if (history.length) lines.push(`History: ${history.join(' · ')}`);
    if (!active) return { lines };
    const guessButton = (direction, emoji) => {
      const chance = hlChance(state.current, direction);
      const label = state.free
        ? `${direction === 'higher' ? 'Higher' : 'Lower'} (${Math.round(chance * 100)}%)`
        : `${direction === 'higher' ? 'Higher' : 'Lower'} → ×${hlMultiplierAfter(state.multiplier, state.current, direction)}`;
      return button(act(session, direction), { label, emoji, style: ButtonStyle.Primary, disabled: chance === 0 });
    };
    const buttons = [guessButton('higher', '⬆️'), guessButton('lower', '⬇️')];
    if (!state.free && state.streak > 0) buttons.push(button(act(session, 'cashout'), { label: 'Cash out', emoji: '💰', style: ButtonStyle.Success }));
    return { lines, rows: [row(...buttons)] };
  },

  scratchcard(session, { active }) {
    const { state } = session;
    if (!active) {
      return { lines: [0, 3, 6].map((i) => state.grid.slice(i, i + 3).join(' ')) };
    }
    const squares = state.grid.map((symbol, i) => (state.revealed.includes(i)
      ? button(act(session, `reveal:${i}`), { emoji: symbol, disabled: true })
      : button(act(session, `reveal:${i}`), { label: '?', style: ButtonStyle.Primary })));
    return {
      lines: ['Scratch the squares. Three matching symbols win.'],
      rows: [...rows(squares, 3), row(button(act(session, 'all'), { label: 'Reveal all', emoji: '✨', style: ButtonStyle.Success }))],
      quit: false,
    };
  },

  trivia(session, { active }) {
    const { state } = session;
    const category = TRIVIA_CATEGORIES[state.category];
    const lines = [`${category.emoji} ${category.label}${difficultyText(state.difficulty)}`, `**${state.question}**`];
    const letters = ['A', 'B', 'C', 'D'];
    if (!active) {
      lines.push(...state.choices.map((choice, i) => {
        const mark = i === state.answer ? '✅' : i === state.picked ? '❌' : '▫️';
        return `${mark} ${letters[i]}. ${choice}`;
      }));
      return { lines };
    }
    const options = state.choices.map((choice, i) => button(act(session, `pick:${i}`), { label: `${letters[i]}. ${choice}` }));
    return { lines, rows: rows(options, 2) };
  },

  quickmath(session, { active }) {
    const { state } = session;
    if (!active) return { lines: [`${state.text} = **${state.answer}**`] };
    const lines = [`Solve: **${state.text} = ?**`, `Tries left: ${state.attemptsLeft}`];
    if (state.tries.length) lines.push(`Tried: ${state.tries.join(', ')}`);
    return { lines, rows: [row(button(cid('game', 'ask', session.id), { label: 'Answer', emoji: '✏️', style: ButtonStyle.Primary }))] };
  },

  guess(session, { active }) {
    const { state } = session;
    const lines = [`A number from 1 to ${state.max}${difficultyText(state.difficulty)}.`];
    if (state.guesses.length) lines.push(`Guesses: ${state.guesses.join(', ')}`);
    if (!active) return { lines };
    lines.push(`It is between **${state.low}** and **${state.high}**.`, `Guesses left: ${state.attempts - state.guesses.length}`);
    return { lines, rows: [row(button(cid('game', 'ask', session.id), { label: 'Guess', emoji: '🎯', style: ButtonStyle.Primary }))] };
  },

  wordguess(session, { active }) {
    const { state } = session;
    const board = state.guesses.map((g) => `${g.marks.map((m) => MARK[m]).join('')}  \`${g.word}\``);
    if (active) for (let i = state.guesses.length; i < WORDGUESS_TRIES; i += 1) board.push('⬜⬜⬜⬜⬜');
    const lines = [...board];
    if (active) {
      lines.push('', `Guesses left: ${WORDGUESS_TRIES - state.guesses.length}`);
      return { lines, rows: [row(button(cid('game', 'ask', session.id), { label: 'Guess a word', emoji: '🔤', style: ButtonStyle.Primary }))] };
    }
    return { lines };
  },

  memory(session, { active }) {
    const { state } = session;
    const lines = [`Pairs found: **${state.matched.length / 2}** / ${state.pairs} · Moves: ${state.moves} / ${state.maxMoves}`];
    if (!active) {
      lines.push(...rowsOf(state.cards, state.columns).map((r) => r.join(' ')));
      return { lines };
    }
    const tiles = state.cards.map((symbol, i) => {
      if (state.matched.includes(i)) return button(act(session, `flip:${i}`), { emoji: symbol, style: ButtonStyle.Success, disabled: true });
      if (state.first === i || state.shown.includes(i)) return button(act(session, `flip:${i}`), { emoji: symbol, style: ButtonStyle.Primary, disabled: state.first === i });
      return button(act(session, `flip:${i}`), { emoji: '❔' });
    });
    return { lines, rows: rows(tiles, state.columns) };
  },

  pattern(session, { active }) {
    const { state } = session;
    if (!active) return { lines: [`${state.correct} / ${state.rounds.length} correct${difficultyText(state.difficulty)}.`] };
    const round = state.rounds[state.round];
    const options = round.options.map((option, i) => button(act(session, `pick:${i}`), { label: option, style: ButtonStyle.Primary }));
    return { lines: [`**Round ${state.round + 1} of ${state.rounds.length}**${difficultyText(state.difficulty)}`, round.prompt], rows: [row(...options)] };
  },

  unscramble(session, { active }) {
    const { state } = session;
    if (!active) return { lines: [`\`${[...state.scrambled].join(' ')}\` → **${state.word}**`] };
    const lines = [`Unscramble: **\`${[...state.scrambled].join(' ')}\`**${difficultyText(state.difficulty)}`, `Tries left: ${state.attemptsLeft}`];
    if (state.hint) lines.push(`💡 Starts with **${state.word[0]}**, ends with **${state.word.at(-1)}**`);
    return {
      lines,
      rows: [row(
        button(cid('game', 'ask', session.id), { label: 'Answer', emoji: '✏️', style: ButtonStyle.Primary }),
        button(act(session, 'hint'), { label: 'Hint (−30%)', emoji: '💡', disabled: state.hint }),
      )],
    };
  },

  reaction(session, { active, now }) {
    const { state } = session;
    const target = REACTION.colours[state.target];
    if (!active) return { lines: [`The colour was ${target.emoji} ${target.name}.`] };
    const go = now >= state.goAt;
    const lines = [go ? `🚦 **GO! Press ${target.emoji} ${target.name.toUpperCase()}!**` : '⏳ Get ready… When I say **GO**, press the colour I name. Pressing early loses.'];
    const buttons = state.order.map((colour, i) => button(act(session, `press:${i}`), { emoji: REACTION.colours[colour].emoji }));
    return { lines, rows: [row(...buttons)] };
  },

  fish(session, { active, now }) {
    const { state } = session;
    const lines = [`Fishing level **${state.level}**`];
    if (!active) return { lines };
    lines.push(now >= state.biteAt ? '🐟 **Something is biting! Reel it in!**' : '🎣 Your line is in the water… wait for a bite, then reel in. Reeling early scares the fish.');
    if (state.early) lines.push(`Early reels: ${state.early}`);
    return { lines, rows: [row(button(act(session, 'reel'), { label: 'Reel in', emoji: '🎣', style: ButtonStyle.Primary }))] };
  },

  treasure(session, { active }) {
    const { state } = session;
    const dug = new Map(state.dug.map((d) => [d.index, d]));
    const lines = [`Digs left: **${state.digsLeft}** · Loot: **${formatCoins(state.value)}**`, 'Empty holes show the distance to the nearest treasure: 🔥 1 · 🌡️ 2 · ❄️ 3+'];
    if (!active) {
      const map = state.cells.map((cell, i) => {
        if (dug.get(i)?.kind === 'trap') return '💥';
        if (cell === 'trap') return '💣';
        if (cell) return LOOT[cell].emoji;
        return dug.has(i) ? '🕳️' : '🟫';
      });
      return { lines: [lines[0], ...rowsOf(map, state.columns).map((r) => r.join(''))] };
    }
    const tiles = state.cells.map((cell, i) => {
      const hole = dug.get(i);
      if (!hole) return button(act(session, `dig:${i}`), { label: '?' });
      if (hole.kind === 'loot') return button(act(session, `dig:${i}`), { emoji: LOOT[hole.key].emoji, style: ButtonStyle.Success, disabled: true });
      return button(act(session, `dig:${i}`), { emoji: hole.distance ? HINT(hole.distance) : '🕳️', label: hole.distance ? String(hole.distance) : undefined, disabled: true });
    });
    return {
      lines,
      rows: [...rows(tiles, state.columns), row(button(act(session, 'leave'), { label: 'Leave with loot', emoji: '🎒', style: ButtonStyle.Success }))],
      quit: false,
    };
  },

  rps(session, { active }) {
    const { state } = session;
    const lines = [`${state.mode === 'bo3' ? 'Best of three' : 'Single round'} · You **${state.score.host}** – **${state.score.opponent}** Bot`];
    const log = state.rounds.slice(-5).map((r) => `${rpsEmoji(r.host)} vs ${rpsEmoji(r.opponent)} ${r.result > 0 ? '✅' : r.result < 0 ? '❌' : '➖'}`);
    if (log.length) lines.push(log.join('\n'));
    return { lines, rows: active ? [row(...rpsButtons((choice) => act(session, `pick:${choice}`)))] : [] };
  },
};

// ── Results ────────────────────────────────────────────────────────────────

function soloResult(session, settlement) {
  const player = settlement.players[0];
  const meta = GAMES[session.game];
  if (isFreePlay(session.game, session.stake)) {
    if (player.result !== 'win') return player.xp ? `No coins this time · +${player.xp} XP` : 'No reward this time.';
    const parts = [`**+${formatCoins(player.payout)}**`];
    if (player.xp) parts.push(`+${player.xp} XP`);
    if (player.gameXp) parts.push(`+${player.gameXp} ${meta.name.toLowerCase()} XP`);
    const capped = player.capped ? '\n_You have reached today\'s coin limit for free games, so this reward was reduced._' : '';
    return `${parts.join(' · ')}${capped}`;
  }
  if (player.result === 'win') return `You won **${formatCoins(player.net)}** (${formatCoins(player.payout)} returned).`;
  if (player.result === 'push') return `Push: your ${formatCoins(player.stake)} stake was returned.`;
  return player.payout > 0
    ? `You got back ${formatCoins(player.payout)} of your ${formatCoins(player.stake)} stake.`
    : `You lost **${formatCoins(player.stake)}**.`;
}

function closedText(session) {
  if (session.status === 'cancelled') return 'Cancelled. Nothing was taken.';
  if (!session.state) return '⏰ This offer expired. Nothing was taken.';
  return session.stake > 0 ? '⏰ Time ran out before a result, so your stake was returned.' : '⏰ Time ran out.';
}

// ── Solo games ─────────────────────────────────────────────────────────────

const stakeField = (session) => {
  const meta = GAMES[session.game];
  if (meta.stake === 'fixed') return { name: 'Price', value: formatCoins(session.stake), inline: true };
  return session.stake > 0 ? { name: 'Stake', value: formatCoins(session.stake), inline: true } : { name: 'Mode', value: 'Free play', inline: true };
};

/** The confirmation card for a staked game: rules and payouts are shown before anything is taken. */
export function confirmView(ctx, session) {
  const meta = GAMES[session.game];
  const kit = ctx.embeds.for(session.guild_id);
  const { stake, options } = session;
  const preview = {
    coinflip: [`Win: **+${formatCoins(stake)}** (${formatCoins(stake * 2)} returned) · Lose: −${formatCoins(stake)}`],
    dice: [`Win: **+${formatCoins(stake)}** · Tie: stake returned · Lose: −${formatCoins(stake)}`],
    roulette: [`Your bet: **${ROULETTE_BETS[options.bet]?.label}${options.bet === 'number' ? ` ${options.number}` : ''}**`, `Win: ${formatCoins(stake * (ROULETTE_BETS[options.bet]?.multiplier ?? 0))} returned · Lose: −${formatCoins(stake)}`],
    rps: [`Win: **+${formatCoins(stake)}** · Draw: stake returned · Lose: −${formatCoins(stake)}`, `Mode: ${options.mode === 'bo3' ? 'best of three' : 'single round'}`],
  }[session.game] ?? meta.payouts;
  const lines = [meta.rules, '', ...preview.map((line) => `• ${line}`), '', `Nothing is taken until you confirm. This offer expires ${discordTimestamp(session.expires_at, 'R')}.`];
  const go = (action, opts) => button(action ? cid('game', 'go', session.id, action) : cid('game', 'go', session.id), opts);
  const actions = {
    coinflip: [
      go('heads', { label: 'Heads', emoji: '🪙', style: options.choice === 'heads' ? ButtonStyle.Success : ButtonStyle.Primary }),
      go('tails', { label: 'Tails', emoji: '🪙', style: options.choice === 'tails' ? ButtonStyle.Success : ButtonStyle.Primary }),
    ],
    dice: [go('roll', { label: 'Roll', emoji: '🎲', style: ButtonStyle.Success })],
    slots: [go('spin', { label: 'Spin', emoji: '🎰', style: ButtonStyle.Success })],
    roulette: [go('spin', { label: 'Spin', emoji: '🎡', style: ButtonStyle.Success })],
    blackjack: [go('deal', { label: 'Deal', emoji: '🃏', style: ButtonStyle.Success })],
    higherlower: [go(null, { label: 'Start', emoji: '▶️', style: ButtonStyle.Success })],
    scratchcard: [go(null, { label: `Buy for ${formatCoins(stake)}`, emoji: '🎟️', style: ButtonStyle.Success })],
    rps: rpsButtons((choice) => cid('game', 'go', session.id, `pick:${choice}`)),
  }[session.game];
  const embed = kit.base({ title: `${meta.emoji} ${meta.name}`, description: lines.join('\n') }).addFields(stakeField(session));
  return {
    embeds: [embed],
    components: [row(...actions, button(cid('game', 'cancel', session.id), { label: 'Cancel', style: ButtonStyle.Danger }))],
    allowedMentions: { parse: [] },
  };
}

/** The live or finished screen for a solo game. */
export function gameView(ctx, session, { feedback = null, settlement = null, now = Date.now() } = {}) {
  if (session.status === 'pending') return confirmView(ctx, session);
  const meta = GAMES[session.game];
  const kit = ctx.embeds.for(session.guild_id);
  const active = session.status === 'active';
  const screen = session.state ? SCREENS[session.game](session, { active, now }) : { lines: [] };
  let result = null;
  if (settlement) result = soloResult(session, settlement);
  else if (session.status === 'settled' && session.outcome) result = session.outcome.result === 'win' ? 'Finished: you won.' : 'Finished.';
  else if (!active) result = closedText(session);
  const description = [feedback, screen.lines.join('\n'), result].filter(Boolean).join('\n\n');
  const title = `${meta.emoji} ${meta.name}`;
  const tone = settlement?.players[0]?.result;
  const embed = tone === 'win' ? kit.success(title, description)
    : tone === 'loss' ? kit.error(title, description)
      : tone === 'push' ? kit.info(title, description)
        : kit.base({ title, description });
  embed.addFields(stakeField(session));
  if (active) embed.addFields({ name: 'Ends', value: discordTimestamp(session.expires_at, 'R'), inline: true });

  let components = [];
  if (active) {
    components = [...(screen.rows ?? [])];
    if (screen.quit !== false) components.push(row(button(cid('game', 'quit', session.id), { label: 'Quit', style: ButtonStyle.Danger })));
  } else if (session.status === 'settled') {
    components = [row(button(cid('game', 'again', session.id), { label: 'Play again', emoji: '🔁', style: ButtonStyle.Primary }))];
  }
  return { embeds: [embed], components: components.slice(0, 5), allowedMentions: { parse: [] } };
}

/** The brief "spinning" frame shown before a revealed result. */
export function spinFrame(ctx, session) {
  const meta = GAMES[session.game];
  const frames = {
    coinflip: '🪙 The coin spins through the air…',
    'duel-coinflip': '🪙 The coin spins through the air…',
    dice: '🎲 Rolling…',
    'duel-dice': '🎲 Rolling…',
    slots: '🎰 **[ 🔄 | 🔄 | 🔄 ]**',
    roulette: '🎡 The ball is rolling…',
  };
  return { embeds: [ctx.embeds.for(session.guild_id).base({ title: `${meta.emoji} ${meta.name}`, description: frames[session.game] })], components: [], allowedMentions: { parse: [] } };
}

/** The answer form for typed games. */
export function answerModal(session) {
  const forms = {
    quickmath: { label: 'Your answer', placeholder: 'A whole number', max: 12 },
    guess: { label: `Your guess (1 to ${session.state.max})`, placeholder: 'A whole number', max: 5 },
    wordguess: { label: 'A five-letter word', placeholder: 'e.g. CRANE', max: 5, min: 5 },
    unscramble: { label: 'The unscrambled word', placeholder: 'Letters only', max: 20 },
  };
  const form = forms[session.game];
  const input = new TextInputBuilder().setCustomId('answer').setLabel(form.label).setPlaceholder(form.placeholder)
    .setStyle(TextInputStyle.Short).setRequired(true).setMinLength(form.min ?? 1).setMaxLength(form.max);
  return new ModalBuilder().setCustomId(cid('game', 'answer', session.id)).setTitle(truncate(GAMES[session.game].name, 45)).addComponents(row(input));
}

// ── Duels ──────────────────────────────────────────────────────────────────

function duelLog(session) {
  const { state } = session;
  const [host, opponent] = [`<@${session.host_id}>`, `<@${session.opponent_id}>`];
  if (!state) return [];
  if (session.game === 'duel-dice') {
    return state.rolls.map((r, i) => `Roll ${i + 1}: ${host} ${dice(r.host)} vs ${dice(r.opponent)} ${opponent}${r.result === 0 ? ' (tie, roll again)' : ''}`);
  }
  if (session.game === 'duel-coinflip') return state.side ? [`🪙 The coin landed on **${state.side}** (${host} had heads, ${opponent} had tails).`] : [];
  return state.rounds.map((r, i) => `Round ${i + 1}: ${rpsEmoji(r.host)} vs ${rpsEmoji(r.opponent)}${r.result === 0 ? ' (draw)' : ''}`);
}

const CLOSED_REASONS = {
  declined: 'The challenge was declined.',
  withdrawn: 'The challenge was withdrawn.',
  'not accepted': 'Nobody accepted in time.',
  'timed out': 'Nobody played in time.',
  'a player left the server': 'A player left the server.',
};

export function duelView(ctx, session, { feedback = null } = {}) {
  const meta = GAMES[session.game];
  const kit = ctx.embeds.for(session.guild_id);
  const [host, opponent] = [`<@${session.host_id}>`, `<@${session.opponent_id}>`];
  const stakeText = session.stake > 0 ? `${formatCoins(session.stake)} each` : 'a friendly match (no stake)';
  const lines = [];
  let components = [];
  if (session.status === 'open') {
    lines.push(`${host} challenges ${opponent} to **${meta.name}** for ${stakeText}!`, '', meta.rules, '', `${opponent}, accept ${discordTimestamp(session.expires_at, 'R')} or the challenge expires and the stake is returned.`);
    components = [row(
      button(cid('duel', 'accept', session.id), { label: 'Accept', emoji: '⚔️', style: ButtonStyle.Success }),
      button(cid('duel', 'decline', session.id), { label: 'Decline', style: ButtonStyle.Danger }),
      button(cid('duel', 'cancel', session.id), { label: 'Withdraw' }),
    )];
  } else if (session.status === 'active') {
    const { state } = session;
    lines.push(
      `${host} vs ${opponent} · ${stakeText}`,
      `${state.mode === 'bo3' ? 'Best of three' : 'Single round'} · Score **${state.score.host}** – **${state.score.opponent}**`,
      `${host}: ${state.picks.host ? '✅ picked' : '⏳ choosing'} · ${opponent}: ${state.picks.opponent ? '✅ picked' : '⏳ choosing'}`,
      ...duelLog(session),
      '',
      `Both players pick in secret. Time runs out ${discordTimestamp(session.expires_at, 'R')}.`,
    );
    components = [row(...rpsButtons((choice) => cid('duel', 'pick', session.id, choice)))];
  } else if (session.status === 'settled') {
    const { winner, forfeit } = session.outcome ?? {};
    lines.push(`${host} vs ${opponent} · ${stakeText}`, ...duelLog(session), '');
    if (forfeit) lines.push(`⏰ <@${forfeit === 'host' ? session.host_id : session.opponent_id}> ran out of time and forfeits.`);
    if (winner) {
      const winnerId = winner === 'host' ? session.host_id : session.opponent_id;
      lines.push(`🏆 <@${winnerId}> wins${session.stake > 0 ? ` **${formatCoins(session.stake * 2)}**` : ''}!`);
    } else {
      lines.push(`🤝 Draw.${session.stake > 0 ? ' Both stakes were returned.' : ''}`);
    }
    components = [row(button(cid('duel', 'rematch', session.id), { label: 'Rematch', emoji: '🔁', style: ButtonStyle.Primary }))];
  } else {
    lines.push(`${host} vs ${opponent} · ${stakeText}`, '', CLOSED_REASONS[session.outcome?.reason] ?? 'This duel is closed.', session.stake > 0 ? 'Every stake was returned.' : '');
  }
  const description = [feedback, lines.join('\n')].filter(Boolean).join('\n\n');
  return {
    embeds: [kit.base({ title: `⚔️ ${meta.name}`, description })],
    components,
    allowedMentions: { parse: [] },
  };
}
