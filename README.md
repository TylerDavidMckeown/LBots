# Lyss Tools

Four independent Discord bots in one npm-workspaces monorepo. The full specification is in [CLAUDE.md](CLAUDE.md).

| Bot | Folder | Database | Purpose |
|---|---|---|---|
| Lyss Tickets | `tickets-bot/` | `data/tickets.db` | Support, private contact, commissions |
| Lyss Guard | `guard-bot/` | `data/guard.db` | Moderation, logging, anti-spam |
| Lyss Community | `community-bot/` | `data/community.db` | Community features and the game world |
| ALYSS | `ai-bot/` | `data/ai.db` | AI conversations (Groq) |

Each bot has its own Discord application, token, `.env`, database and process. One bot can restart or crash without affecting the others.

## Build status

| Phase | Status |
|---|---|
| 1. Shared foundation | **Done**: bootstrap, loader, router, database and migrations, scheduler, permissions, error reporting, embeds, `/help`, `/status`, `/setup`, deployment, backups |
| 2. Lyss Tickets | **Done**: panels, ticket lifecycle, transcripts, ratings, inactivity, blacklist, stats, commissions, quotes, invoices, portfolio, reviews |
| 3. Lyss Guard | **Done**: server logging, moderation cases, warnings and escalation, temporary bans, channel tools, notes and history, anti-spam |
| 4. Community foundations | **Done**: auto roles, welcome, boosts, suggestions, giveaways, polls, starboard, birthdays, embed builder |
| 5. Economy | **Done**: Lyss Coins wallet and bank, daily/weekly/monthly rewards with streaks, payments, crime, robbery, transactions, leaderboards, dashboard, admin tools |
| 6. Interactive jobs | **Done**: `/work` with all 12 interactive jobs, per-job levels and unlocks, rare variants, stats and leaderboard |
| 7. Mini-games | **Done**: all 21 roadmap games (duels and pet battles included), `/games` dashboard, published payout tables, escrowed stakes |
| 8. Pets and progression | **Done**: `/pet` with adoption, eggs, care, training, naps, exploring, expeditions, evolution, accessories, collection, leaderboards and turn-based battles; member levels with rewards (`/level`, `/xp`, `/progression`); a basic inventory for pet items |
| 9 to 13 | Not started. The shop, `/inventory` commands and custom roles are phase 9. See the roadmap in CLAUDE.md §28 |

## Requirements

- Node.js 22 LTS or newer
- Four applications in the [Discord Developer Portal](https://discord.com/developers/applications)

## First-time setup

1. **Install dependencies**
   ```sh
   npm install
   ```
2. **Create the Discord applications.** For each bot, create an application, add a bot user, and enable these **Privileged Gateway Intents** (Bot tab):

   | Bot | Server Members | Message Content |
   |---|---|---|
   | Lyss Tickets | — | ✅ |
   | Lyss Guard | ✅ | ✅ |
   | Lyss Community | ✅ | ✅ |
   | ALYSS | — | ✅ |

   A bot whose intents are not enabled fails to log in with a message explaining this.
3. **Invite each bot** using OAuth2 › URL Generator with the scopes `bot` and `applications.commands`, plus the permissions listed for that bot in CLAUDE.md §24.
4. **Configure environment files**
   ```sh
   for b in tickets-bot guard-bot community-bot ai-bot; do cp $b/.env.example $b/.env; done
   ```
   Fill in `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` and `OWNER_ID` in each file.
5. **Register slash commands**
   ```sh
   npm run deploy:all              # into GUILD_ID (instant)
   npm run deploy -w ai-bot -- --global   # application-wide (can take up to an hour)
   ```
6. **Start the bots**
   ```sh
   npm run start:community         # one bot in the foreground
   pm2 start ecosystem.config.cjs  # all four under PM2
   ```
7. In Discord, run `/setup view`, configure channels and roles with `/setup channel`, `/setup role` and `/setup value`, then run `/setup check`.

## Commands

| Command | Who | What |
|---|---|---|
| `/help` | Everyone | Category dropdown listing only the commands you can use |
| `/status` | Everyone | Uptime, ping, memory, database health, pending jobs, version |
| `/setup view` | Admin | Every setting, showing what is set, defaulted or missing |
| `/setup check` | Admin | Verifies permissions, channels, roles, category capacity, env vars (presence only) and database health |
| `/setup channel` / `role` / `value` | Admin | Change a setting (autocomplete lists valid settings) |
| `/setup reset` | Admin | Return a setting to its default |

## Lyss Tickets

**Setup.** Use `/setup channel` to set the three ticket categories, plus the transcript and ticket-log channels. Use `/setup role` to set the support role, and optionally the contact and commission roles. Then post the panels with `/panel support`, `/panel contact` and `/panel commissions`.

**Who can see and handle tickets.** The owners in `OWNER_ID` can always handle every type.

| Type | Visible to | Handled by |
|---|---|---|
| Support | Opener, support / staff / moderator / admin roles | Support role, or Staff tier and above |
| Contact Lyss | Opener, contact role, owners | Contact role, owners |
| Commission | Client, commission role, owners | Commission role, owners |

**Lifecycle.** The panel button opens a form and creates a private channel. The database reserves the ticket before the channel is created, so a double-click can't create two tickets. Closing locks the channel and saves an HTML transcript to `tickets-bot/data/transcripts/`. The transcript is also posted to the transcript channel and DMed to the opener, if enabled. The opener is then asked for a 1–5 rating. The channel is deleted after the retention period (24h by default) unless it is reopened. Support tickets get an inactivity reminder after 48h and close automatically 24h later. Commission and contact tickets never auto-close.

**Commissions.** The workflow is Requested → Quoted → Accepted → In progress ⇄ Revisions → Delivered → Completed, and a commission can be cancelled from any open stage. Every change is recorded in `commission_events`.

| Command | Purpose |
|---|---|
| `/commissions open` / `closed` / `slots` / `list` | Availability and the live slot counter on the panel |
| `/quote create` | Send a numbered quote (Q-0001). The client accepts it, requests changes or declines it with buttons |
| `/commission status` / `cancel` / `view` | Move the workflow (staff only). The client is notified in the ticket and by DM |
| `/invoice create` / `paid` / `unpaid` / `view` | One invoice per accepted quote (INV-0001), with the configured payment instructions |
| `/portfolio add` / `remove` / `view` | Portfolio entries with images and tags |
| `/reviews` | Client reviews and the average score. Clients are invited to review on completion |

Accepting a quote claims a slot, and requests are refused when commissions are closed or every slot is taken. Money is stored as integer cents.

## Lyss Guard

**Setup.** Use `/setup channel` to set a shared log channel, and optionally separate member, message, server and moderation log channels. Set the moderator role with `/setup role`. Give Lyss Guard a role above the members it moderates. Anti-spam starts **off**: turn it on with `/antispam toggle`.

**Logging.** `/logs status`, `/logs toggle` and `/logs ignore` control what is logged.

| Category | Events |
|---|---|
| member | Joins (with account age and a new-account flag), leaves, kicks, nickname and role changes |
| message | Edits and deletions, which use a 7-day content cache so they survive restarts, plus bulk deletions with a text file attached |
| server | Channel and role creation, deletion and changes |
| moderation | Every case, anti-spam actions, and bans or timeouts made outside the bot |

The audit log is used to show who made each change. Actions taken by Lyss Guard are logged once, as cases, not twice.

**Moderation.**
- `/warn`, `/timeout`, `/kick`, `/ban`, `/tempban` and the other moderation commands create numbered cases. `/case view` shows a case and `/case reason` updates its reason, which also edits the log message.
- Moderators can only act on members below their highest role and below the bot's. The server owner and `OWNER_ID` users are protected.
- Reasons are required for warnings, timeouts, kicks and bans unless `guard.requireReason` is turned off.
- Members are DMed before an action, if they allow DMs.
- Warnings expire after 30 days.
- Escalation (`3:1h, 5:24h` by default) times a member out when they reach exactly that many active warnings, once per warning.
- Temporary bans lift automatically, unless a newer ban or unban decision has been made since.

**Anti-spam.**
- Rules: 5 messages in 5 seconds, 3 identical messages in 30 seconds, 5 or more mentions, and invites (with an allow list). Optional rules catch excessive capitals and emoji.
- The first offence deletes the messages and posts a brief notice. The second adds a warning case and a 5-minute timeout. Any further offence within 10 minutes gives a 1-hour timeout.
- Messages from the same burst are cleaned up without being punished again.
- Staff and whitelisted roles or channels are exempt. Adjust everything with `/antispam config`.

## Lyss Community

Each feature lives in `community-bot/src/features/<feature>.js` with its commands, buttons, events and jobs. Set channels and roles with `/setup channel` and `/setup role`, and tune behaviour with `/setup value` (welcome text, starboard threshold and emoji, birthday hour, boost reward and so on).

| Feature | Commands | Notes |
|---|---|---|
| Auto roles | `/autorole add/remove/list/post` | Buttons for up to 10 roles, a dropdown beyond that. Roles with moderation or admin permissions, tier roles and roles above the bot are refused. |
| Welcome | `/welcome test/toggle/configure` | Pings the member outside the embed. Shows member count, account age, links and an optional banner. |
| Boosts | `/boost test/toggle/status/rewards` | Thank-you embed, optional booster role and an optional one-time LC reward (once per boost). Ended boosts stay private unless enabled. |
| Suggestions | `/suggest`, `/suggestion approve/deny/consider/implemented` | One vote per member, with switching or removing. Optional thread. Authors can delete while pending and get a DM when staff respond. |
| Giveaways | `/giveaway start/end/reroll/cancel/list` | Enter button with a live count and an optional required role. Winners are re-checked when drawn, and ending is exactly once and survives restarts. |
| Polls | `/poll create/end` | 2–10 options, single or multiple choice, anonymous or with a voters list, live bars and auto-close. |
| Starboard | `/starboard status/exclude/include` | Ignores self-stars and bots, updates or removes posts as stars change, and handles one message at a time. |
| Birthdays | `/birthday set/view/upcoming/admin` | Locked once set. Age is shown only with a year and permission. One combined post per day, with a temporary birthday role. |
| Embed builder | `/embed create/edit/template` | Drafts with buttons and forms, Discord-limit validation, and templates. Only edits the bot's own messages. |

## Economy (Lyss Coins)

| Command | Purpose |
|---|---|
| `/balance`, `/networth`, `/streak`, `/transactions` | Account views |
| `/daily`, `/weekly`, `/monthly` | Rewards: 500 / 3,500 / 15,000 LC by default. The daily streak bonus is +50 per day, capped at +500 |
| `/pay` | Payment with a confirmation step (single use, expires after 2 minutes) |
| `/deposit`, `/withdraw` | Move coins between wallet and bank (`500`, `2.5k`, `half`, `all`) |
| `/crime`, `/rob` | Risky earnings with persistent cooldowns. Only wallets can be robbed, failed robberies compensate the victim, and robbed members are protected for a while |
| `/leaderboard`, `/richest` | Rankings by net worth, wallet, bank or lifetime earnings |
| `/economy dashboard`, `/economy help` | Personal dashboard with quick actions |
| `/economy admin …` | `balance/add/remove/set/reset/freeze/unfreeze/audit` (admin) and `config` (owner, searchable setting list). A reason is required and everything is audited |

**Integrity:**
- Each operation runs in one SQLite transaction.
- Balances have database CHECK constraints, so they can never go negative.
- Every change is recorded with the balance afterwards.
- Claims are unique per period, and each one stores the UTC time its period ends, so changing the server timezone cannot open an early second claim.
- Cooldowns are stored in the database, so restarts don't reset them.
- Frozen accounts are blocked from all economy activity.

## Work (`/work`)

`/work start [job] [difficulty]` shows a job card with the reward range, XP, time limit and break length. Members then choose **Start job** or **Choose another**. `/work jobs` lists every job, `/work stats [user]` shows job levels, and `/work leaderboard` ranks the hardest workers.

| Job | Task |
|---|---|
| 🍳 Chef, ☕ Barista, ⚒️ Blacksmith | Click the order, recipe or forging steps in the right order |
| ⛏️ Miner | Choose which hidden blocks to mine. The value depends on the ore found |
| 🗺️ Treasure Hunter | Dig on a map. Each dig shows how far away the treasure is |
| 🎣 Fisher | Reel in when the fish bites. Reaction time is measured with server timestamps, and reeling early scares the fish |
| 🚚 Delivery Driver | Pick the shortest route on a small map |
| 📦 Courier | Sort parcels to depots by postcode |
| 💻 Hacker | Fictional puzzles: number sequences, binary, missing symbols, shift ciphers, operator precedence |
| 🕵️ Detective | Read the clues and name the one suspect who fits them all |
| 🌻 Gardener | Decide whether each plant needs watering, harvesting, protecting or pruning |
| 🐾 Pet Caretaker | Work out what each visiting animal needs. Pays 60% of the usual coins plus Pet Treats (pet XP food) |

**Difficulty and pay:**
- Easy: 100–300 LC, from level 1.
- Medium: 180–450 LC, from job level 10.
- Hard: 250–600 LC, from job level 30.
- Pay scales with performance, which is accuracy plus a little speed.

**Job levels:** each job levels on its own.
- Level 5 adds 10% to the reward range.
- Level 20 adds rare variants that pay 1.5×.
- Level 50 adds an exclusive title.
- On top of that, each level adds a 1% bonus.

**Owner settings:** under `/economy admin config`:
- `economy.workEnabled`
- `economy.workCooldown`: the break between jobs, 20 minutes by default.
- `economy.workPayoutPercent`

**Integrity:**
- Each job is a database session with a unique ID. A unique index allows one active job per member.
- Answers stay in the stored session and never go into buttons, which only carry an option index.
- Every click is checked server-side inside a transaction. It must come from the owner, and the session must be active and not expired.
- The reward is paid in the same transaction that closes the session, with the operation key `work:<session>`. A double click or a late click pays nothing.
- The break starts when a job starts, so quitting cannot be used to reroll a task.
- Reward maths lives only in `jobTasks.js` (`calculateReward`). `jobService.js` is the only code that pays it.

## Mini-games

`/games` opens a dashboard with one page per category. Each page lists every game's rules, stake limits, cooldown and full payout table; the tables are generated from `services/games/tables.js`, so they always match the code. The dashboard also shows your stats (24-hour and 7-day totals included), your history, and a button to quit a game in progress.

| Category | Games |
|---|---|
| Casino-style | `/coinflip`, `/dice roll`, `/slots`, `/roulette`, `/blackjack`, `/higherlower`, `/scratchcard` |
| Puzzles (free) | `/trivia` (7 categories, no repeats until all are seen), `/quickmath`, `/guess`, `/wordguess`, `/memory`, `/pattern`, `/unscramble` |
| Reaction (free) | `/reaction`, `/fish` (own fishing level), `/treasure` |
| Multiplayer | `/duel` (dice, coinflip or rock-paper-scissors), `/dice duel`, `/rps` against the bot or a member |
| Daily | `/dailyspin`, once per day in the server timezone |

**Expected returns.** These are checked exactly by the tests:
- Coinflip and dice are even money.
- Every roulette bet returns 36/37.
- Slots return about 93.6%.
- Scratch cards return 84%.
- Higher or Lower pays 95% ÷ the chance of each guess.
- Blackjack pays 3:2, and the dealer stands on all 17s.

**Stakes and settlement**
- A staked game first shows a confirmation card with the payouts; nothing is taken until it is confirmed.
- Confirming moves the stake into escrow (`game_stakes`).
- Each stake is then settled or refunded exactly once, inside one SQLite transaction:
  - every status change is conditional;
  - `game_results` has one row per player per game.
- Duels:
  - The challenger's stake is held when the challenge is posted, and the opponent's when they accept.
  - The winner receives both stakes.
  - A draw, a decline, no answer within 2 minutes, or either player leaving the server returns both stakes.

**When time runs out, or a player quits:**
- Blackjack stands.
- Higher or Lower cashes out (or refunds if no round was won).
- A bought scratch card is revealed and paid.
- Free puzzles end.
- Rock-paper-scissors against the bot refunds if no round was played, and forfeits otherwise.
- In a rock-paper-scissors duel, a player who did not pick forfeits.
- A minute-by-minute job applies these rules and updates each game's message.

**Free games:**
- They pay coins and economy XP, scaled by `economy.gameRewardPercent`.
- Coins are capped per member by `economy.freeGameDailyCap` (5,000 LC per rolling 24 hours by default). Once the cap is reached, XP is still awarded.

**Other rules:**
- One solo game in progress per member.
- Cooldowns are stored in the database and start when a game starts.
- Clicks from anyone but the players are rejected.
- Outcomes come from a cryptographic random source on the server. They are random, but not "provably fair", and the bot never claims they are.

**Owner settings** (`/economy admin config`):
- `gamesEnabled`
- `gameMinBet` and `gameMaxBet` (10 and 50,000)
- `gameCooldownPercent`
- `gameRewardPercent`
- `freeGameDailyCap`

Finished game sessions are pruned after 7 days. Results and statistics are kept permanently.

## Pets (`/pet`)

`/pet dashboard` opens your active pet's profile card: level, happiness, energy, traits, abilities, accessories and battle stats, with buttons to feed, play, explore, nap, train, open expeditions and browse the collection. Only the owner's clicks do anything.

**Getting pets:**
- `/pet adopt` opens the adoption centre. A member's first pet is a free starter (Meadow Bunny, Pebble Turtle, Copper Fox or Lucky Slime).
- Later adoptions cost 2,000 LC (common) to 60,000 LC (epic). Legendary and mythic pets only hatch from eggs found on expeditions.
- `/pet adopt egg:` shows the egg's exact odds before it hatches.
- Every adoption and hatch goes through a single-use confirmation card. A colour variant (Classic, Pastel, Shiny, Prismatic) and traits are rolled when the pet arrives.
- Discovering 3, 5, 8 and 10 species pays collection rewards once each. Released pets still count as discovered.

**Care:**
- Feeding: kibble is free every 30 minutes, and food items add happiness, energy or XP.
- Playing, training a stat and exploring cost energy and have cooldowns.
- `/pet sleep` naps until energy is full.
- Energy refills on its own. Happiness fades slowly but never below 40, and happy pets earn up to 20% more XP.
- Pets never die or lose progress from being left alone.

**Expeditions:**
- Five destinations, from the Enchanted Forest (10 minutes, level 1) to Starfall Valley (90 minutes, level 25).
- The pet is locked while away. A scheduled job turns the expedition message into a **Claim** button when it returns.
- Rewards are rolled and granted exactly once, in the claim transaction. Recalling early brings nothing back.

**Evolution:**
- Stage 2 needs level 15, an Evolution Crystal and 2,500 LC. Stage 3 needs level 35, two Star Shards and 10,000 LC.
- Evolving keeps the pet's id, name, XP, training and record. It adds +3 to every stat and opens the back accessory slot.

**Accessories:**
- One accessory per slot: head, neck (level 10) and back (after the first evolution).
- Accessories live in the inventory, and swapping or releasing a pet returns them.

**Battles:**
- `/pet battle` challenges a member's pet. Each turn the player attacks, guards or uses an ability the pet has unlocked (levels 1, 10 and 25).
- Base stats differ by only a few points between rarities, so levels, training and traits matter more than rarity.
- No coins are staked. XP is limited to 10 rewarded battles per member per 24 hours.
- Not moving within 60 seconds forfeits, and so does leaving the server.

**Releasing** asks for the pet's name to be typed into a form, so it can never happen from a stray click.

**Owner settings** (`/economy admin config`): `petsEnabled`, `petMax` (10), `petPricePercent`, `petXpPercent`.

## Progression

Member XP comes only from the sources in `services/progressionRules.js`:
- jobs;
- winning free puzzle or reaction games;
- winning duels;
- daily, weekly and monthly rewards;
- pet care, adoptions, expeditions, battles and evolutions;
- collection milestones.

Games of chance never give member XP.

**Integrity:**
- Every award is keyed by the activity's operation key (unique in `xp_transactions`), so nothing pays twice.
- Repeatable sources have a rolling 24-hour cap.

**Levels and rewards:**
- Level *n* needs 50·(n−1)² XP.
- Every level pays 100 LC × the level into the bank, so a wallet limit can never block a level-up.
- Milestone levels add accessories, eggs, materials, titles and badges.
- Each level's rewards are recorded in `level_rewards` and granted once.

**Commands:**
- `/level` and `/xp` show your level and where your XP came from.
- `/progression view`, `leaderboard`, `rewards` and `history`.
- `economy.progressionXpPercent` scales all member XP (0 turns it off).

Services report activities through a small hub (`services/activity.js`), and progression listens inside the same transaction. Quests and achievements (phase 10) will subscribe to the same stream.

## Scripts

| Script | Purpose |
|---|---|
| `npm test` | Run the test suite (`node --test`) |
| `npm run check` | Load every bot's config and commands offline and check Discord limits |
| `npm run backup` | Back up all four databases to `backups/` (safe while running) |
| `npm run deploy:<bot>` / `deploy:all` | Register slash commands |
| `npm run start:<bot>` | Start one bot |

Every bot also takes an automatic daily backup (keeping 14) and prunes error logs and finished jobs older than 30 days. Both are configured in `config.js`.

## Deployment

**PM2** (`ecosystem.config.cjs`): `pm2 start ecosystem.config.cjs`, then `pm2 save && pm2 startup`. Restart a single bot with `pm2 restart lyss-community`.

**Docker Compose** (`docker-compose.yml`): `docker compose up -d --build`. Each service mounts its own `data/` folder and the shared `backups/` folder.

Use one supervisor or the other, never both. Never delete the `data/` folders during a deployment.

**Update procedure:** `npm run backup` → `npm ci` → `npm test` → restart the changed bot → check logs and `/status`. Migrations run automatically at startup, each in its own transaction.

## Architecture and conventions

```
shared/src/
  bootstrap.js       starts a bot: env, db, migrations, modules, router, scheduler, shutdown
  botConfig.js       defineBotConfig(): defaults and validation for each bot's config.js
  router.js          interaction dispatch, tier checks, cooldowns, central error handling
  db.js              openDatabase, migrations, runOnce (idempotency), healthCheck
  scheduler.js       database-backed jobs: dedupe keys, retries, crash recovery, recurring jobs
  permissions.js     Owner > Admin > Moderator > Staff > Member > Restricted
  setupKit.js        /setup built from each bot's setting schema
  helpCommand.js     /help         statusCommand.js  /status
  errorReporter.js   LYS-XXXXX references, redaction, error-log channel
  embedStyle.js      shared branded embeds (success / warning / error / info / loading)
  embedBuilder/      Discord-limit validation and the embed builder
  utils/             time, text, safeSend/respond, pagination
shared/migrations/   core tables present in every database
<bot>/src/
  config.js          name, intents, permissions, status rotation, setup schema
  commands/ components/ events/ jobs/   loaded automatically
  db/migrations/     NNN_name.sql, applied in order
```

**Adding a command:** create `<bot>/src/commands/name.js`:

```js
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder().setName('balance').setDescription('View your Lyss Coins'),
  category: 'Economy',               // /help grouping
  tier: 'member',                    // restricted | member | staff | moderator | admin | owner
  subcommandTiers: { 'admin set': 'owner' },
  cooldown: 3,                       // seconds (in-memory; use the database for game cooldowns)
  async execute(interaction, ctx) { /* ctx: db, guildConfig, embeds, scheduler, logger, ... */ },
};
```

**Components** live in `src/components/` with `id: 'feature:action'`. Custom IDs are `namespace:feature:action:args…` (for example `community:pet:feed:42`). Build them with `makeCustomId`. Unknown or expired IDs get a friendly "this has expired" reply. Handlers must re-check database state (ownership, session status) before changing anything.

**Errors:** throw `new UserError('message')` for expected failures, which shows the message to the user. Anything else is logged with secrets redacted, and the user sees only `Reference: LYS-XXXXX`.

**Rewards and money:** wrap every grant, settlement or claim in `runOnce(db, uniqueKey, () => { ... })`. It runs inside a transaction, applies exactly once per key, and rolls back completely on failure. Scheduler handlers can run more than once after a crash, so they must use it too.

**Jobs:** files in `src/jobs/` export `{ type, execute(payload, task, ctx), every? }`. Queue one-off jobs with `ctx.scheduler.schedule(type, runAt, payload, { dedupeKey })`.

## Secrets

`.env` files, databases, logs and backups are git-ignored. Tokens and API keys are redacted from logs and error reports, and `/setup check` reports only whether environment variables are present.
# LBots
