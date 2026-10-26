# LYSS TOOLS
## Complete Discord Bot Ecosystem — Technical & Feature Specification

**Project:** Lyss Tools  
**Bots:** Lyss Tickets, Lyss Guard, Lyss Community, ALYSS  
**Language:** JavaScript (ES modules)  
**Discord library:** discord.js v14  
**Database:** SQLite using better-sqlite3  
**AI provider:** Groq  
**Recommended runtime:** Node.js 22 LTS  
**Process manager:** PM2 or Docker Compose  
**Architecture:** Four independent Discord applications in one monorepo

---

# 1. Project Vision

Lyss Tools is a collection of four specialised Discord bots designed to provide a complete community-management and entertainment ecosystem.

Each bot has a distinct purpose, its own Discord application, its own token, its own database, and its own configuration.

The project should feel cohesive: consistent embed styling, predictable command structures, interactive interfaces, useful error messages, and persistent data across restarts.

The biggest expansion is **Lyss Community**, which will become a full Discord game system featuring an economy, jobs, mini-games, collectible pets, progression, achievements, customisable profiles, a shop, custom Discord roles, and community events.

## 1.1 The four bots

| Bot | Directory | Primary responsibility |
|---|---|---|
| Lyss Tickets | `tickets-bot/` | Support, private contact, commissions |
| Lyss Guard | `guard-bot/` | Moderation, logs, anti-spam |
| Lyss Community | `community-bot/` | Community management and interactive games |
| ALYSS | `ai-bot/` | AI conversations, memory and personas |

Each bot must be able to restart, update, or go offline without bringing down the other three.

## 1.2 Shared branding

All four bots should share a common visual design:

- Consistent embed layout.
- Configurable primary and secondary colours.
- Consistent timestamp and footer formatting.
- Matching error messages.
- Custom emojis where available.
- Interactive buttons and dropdowns.
- Clear loading, success, warning, and failure states.

The exact brand colours, bot avatars, names, and footer text must be configurable rather than hardcoded throughout the project.

## 1.3 Core design principles

1. Every feature must have a clear owner.
2. Persistent data must survive restarts and redeployments.
3. Every administrative action must enforce permissions.
4. Economy changes must be recorded and protected against duplication.
5. Interactive components must remain functional after restarts.
6. User-facing errors must explain what went wrong without exposing secrets.
7. Every bot must provide `/help`, `/setup`, and `/status`.
8. Configuration changes should not normally require editing source files.
9. Commands should use Discord slash commands rather than relying on message prefixes.
10. Game features must be designed to prevent common exploits, duplicated rewards, and unfair trading.

---

# 2. Technical Architecture

## 2.1 Technology stack

| Component | Technology | Purpose |
|---|---|---|
| Runtime | Node.js 22 LTS | Executes the bots |
| Discord integration | discord.js v14 | Slash commands, events, buttons, modals |
| Database | better-sqlite3 | Persistent bot data |
| AI | groq-sdk | ALYSS conversations |
| Configuration | dotenv and config modules | Secrets and defaults |
| Date and time | Luxon | Birthdays, schedules, timezones |
| Process management | PM2 | Restarts and startup management |
| Alternative deployment | Docker Compose | Container-based deployment |
| Repository | npm workspaces | Shared code and four applications |
| Logging | Structured local logs plus Discord error channels | Troubleshooting |

Package versions must be checked and pinned when implementation begins.

## 2.2 Repository structure

```text
lyss-tools/
├── package.json
├── package-lock.json
├── ecosystem.config.cjs
├── docker-compose.yml
├── .gitignore
├── .env.example
├── README.md
│
├── shared/
│   ├── package.json
│   └── src/
│       ├── bootstrap.js
│       ├── loader.js
│       ├── router.js
│       ├── db.js
│       ├── scheduler.js
│       ├── permissions.js
│       ├── errorReporter.js
│       ├── statusRotator.js
│       ├── helpCommand.js
│       ├── setupKit.js
│       ├── embedStyle.js
│       ├── embedBuilder/
│       │   ├── builder.js
│       │   └── validators.js
│       └── utils/
│           ├── time.js
│           ├── text.js
│           ├── safeSend.js
│           └── pagination.js
│
├── tickets-bot/
│   ├── package.json
│   ├── .env.example
│   ├── data/
│   └── src/
│       ├── index.js
│       ├── config.js
│       ├── deploy-commands.js
│       ├── db/migrations/
│       ├── commands/
│       ├── components/
│       ├── events/
│       ├── services/
│       ├── jobs/
│       └── embeds/
│
├── guard-bot/
│   ├── package.json
│   ├── .env.example
│   ├── data/
│   └── src/
│       ├── index.js
│       ├── config.js
│       ├── deploy-commands.js
│       ├── db/migrations/
│       ├── commands/
│       ├── components/
│       ├── events/
│       ├── services/
│       ├── jobs/
│       └── embeds/
│
├── community-bot/
│   ├── package.json
│   ├── .env.example
│   ├── data/
│   └── src/
│       ├── index.js
│       ├── config.js
│       ├── deploy-commands.js
│       ├── db/migrations/
│       ├── commands/
│       │   ├── setup.js
│       │   ├── autorole.js
│       │   ├── welcome.js
│       │   ├── boost.js
│       │   ├── suggest.js
│       │   ├── suggestion.js
│       │   ├── giveaway.js
│       │   ├── poll.js
│       │   ├── starboard.js
│       │   ├── birthday.js
│       │   ├── embed.js
│       │   ├── economy/
│       │   ├── jobs/
│       │   ├── games/
│       │   ├── pets/
│       │   ├── progression/
│       │   ├── shop/
│       │   ├── profile/
│       │   ├── achievements/
│       │   ├── quests/
│       │   ├── inventory/
│       │   ├── trading/
│       │   ├── events/
│       │   └── help.js
│       ├── components/
│       │   ├── autoroleToggle.js
│       │   ├── suggestionVote.js
│       │   ├── giveawayEnter.js
│       │   ├── pollVote.js
│       │   ├── economyButtons.js
│       │   ├── gameButtons.js
│       │   ├── petButtons.js
│       │   ├── shopButtons.js
│       │   ├── profileButtons.js
│       │   ├── tradeButtons.js
│       │   └── eventButtons.js
│       ├── events/
│       ├── services/
│       │   ├── economyService.js
│       │   ├── transactionService.js
│       │   ├── jobService.js
│       │   ├── gameService.js
│       │   ├── petService.js
│       │   ├── progressionService.js
│       │   ├── shopService.js
│       │   ├── roleShopService.js
│       │   ├── boosterService.js
│       │   ├── profileService.js
│       │   ├── achievementService.js
│       │   ├── questService.js
│       │   ├── inventoryService.js
│       │   ├── tradeService.js
│       │   └── eventService.js
│       ├── jobs/
│       ├── embeds/
│       └── assets/
│
└── ai-bot/
    ├── package.json
    ├── .env.example
    ├── data/
    └── src/
        ├── index.js
        ├── config.js
        ├── deploy-commands.js
        ├── db/migrations/
        ├── commands/
        ├── events/
        ├── services/
        ├── personas/
        ├── jobs/
        └── embeds/
```

This is the target structure. Implementation can begin with a smaller number of files, but responsibilities should remain separated.

---

# 3. Shared Systems Used by All Four Bots

## 3.1 Configuration

Every bot has a `config.js` file containing defaults.

Server-specific settings are stored in that bot's database and override the defaults.

For example:

- Log channel IDs.
- Moderator role IDs.
- Welcome channel.
- Bot status rotation.
- Embed colours.
- Feature toggles.
- Command cooldowns.

`/setup view` displays the configuration, showing which values are configured and which are missing.

`/setup check` verifies permissions, role hierarchy, channel access, category capacity, and required configuration.

Secrets must stay in environment variables and must never be stored in public configuration messages.

## 3.2 Persistent interactions

Buttons, modals, and select menus must use structured custom IDs.

Examples:

```text
community:shop:page:2
community:pet:feed:PET_ID
community:game:coinflip:GAME_ID
community:trade:accept:TRADE_ID
tickets:ticket:close:TICKET_ID
```

The shared router dispatches each interaction to the correct handler.

Persistent components must work after restarts. Temporary game sessions and trade offers must also be checked against their database state before any action is applied.

Expired interactions must display a friendly message instead of changing data.

## 3.3 Database scheduler

Each bot has its own database-backed scheduler.

It handles:

- Giveaway endings.
- Poll endings.
- Temporary bans.
- Warning expiry.
- Ticket inactivity.
- Ticket cleanup.
- Birthday announcements.
- Pet expedition completion.
- Booster expiry.
- Shop rotations.
- Quest resets.
- Daily rewards.
- Temporary custom-role expiry.
- Community event schedules.

Jobs must be recoverable after a restart.

A scheduled reward must never be granted twice because a job ran more than once.

## 3.4 Permissions

Use these internal permission tiers:

| Tier | Access |
|---|---|
| Owner | All bot administration |
| Admin | Configuration and administrative commands |
| Moderator | Moderation and approved community-management actions |
| Staff | Explicitly assigned support tasks |
| Member | Normal commands |
| Restricted member | Limited access according to configured restrictions |

Each command defines its required permissions explicitly.

A member must never be able to grant themselves staff permissions, edit another person's balance, change shop prices, or modify server-wide economy settings.

## 3.5 Embeds

All bots use a shared embed factory.

Embeds should support:

- Author and footer.
- Title and description.
- Fields.
- Thumbnail and image.
- Timestamp.
- Configurable colours.
- Buttons and dropdowns.
- Consistent success and error styles.

The design must respect Discord's message and embed limits.

## 3.6 Error handling

Every command, event, button, modal, and background job must use central error handling.

An error record should contain:

- Error ID.
- Bot name.
- Command or event.
- User and channel IDs where applicable.
- Timestamp.
- Sanitised error details.

The user receives a short message such as:

"Something went wrong. Reference: `LYS-8F31A`."

Full details remain in the local log and authorised error-log channel. Tokens, API keys, and other secrets must be redacted.

## 3.7 Help and status

Every bot provides:

- `/help`
- `/status`
- `/setup`
- `/setup view`
- `/setup check`

Help should use category dropdowns and only display commands available to the person viewing it.

Status rotation should update at a conservative interval, approximately every 45 seconds, to avoid excessive presence updates.

---

# 4. Lyss Tickets — Complete Feature Plan

Lyss Tickets handles support, private contact requests, and commissions.

## 4.1 Ticket panels

Three independently configurable panels are provided.

| Panel | Purpose | Visibility |
|---|---|---|
| Support | General questions, setup help, troubleshooting | Opener and support staff |
| Contact Lyss | Private contact, partnerships, personal enquiries | Opener and designated owner |
| Commissions | Requests for paid creative or technical work | Client and designated owner |

Commands:

```text
/panel support
/panel contact
/panel commissions
/panel edit
/ticket add
/ticket remove
/ticket blacklist add
/ticket blacklist remove
/ticket blacklist list
/ticketstats
```

Panel commands are restricted to authorised administrators.

## 4.2 Ticket lifecycle

1. A user clicks a panel button.
2. The bot checks whether the user is blacklisted.
3. The bot checks whether that user already has an open ticket of that type.
4. A new channel is created with the correct permissions.
5. The bot posts a welcome embed.
6. The ticket opener receives a private link.
7. Staff can claim, unclaim, close, or manage the ticket.
8. Closing produces an HTML transcript.
9. The ticket remains available for a configurable retention period.
10. The ticket is eventually deleted according to the configured policy.

A database record should track the opener, ticket type, channel, status, claimant, timestamps, close reason, and transcript location.

## 4.3 Ticket commands and actions

- Claim and unclaim.
- Add and remove users.
- Close with confirmation.
- Close with a reason.
- Reopen during the retention period.
- Delete a closed ticket immediately when authorised.
- Ticket blacklist management.
- Ticket statistics.
- Automatic inactivity reminders.
- Optional inactivity-based closure.
- User satisfaction ratings.

Default behaviour:

- Support inactivity reminder after 48 hours.
- A further 24 hours without a response can trigger closure.
- Closed tickets are retained for 24 hours.
- All timings are configurable.
- Commission tickets do not automatically close due to inactivity by default.

## 4.4 Commission management

Commands:

```text
/commissions open
/commissions closed
/commissions slots
/commission status
/quote
/invoice
/portfolio add
/portfolio remove
/portfolio view
/reviews
```

The commission workflow is:

**Request → Quote → Acceptance → In Progress → Revisions → Delivered → Completed**

Cancellation must also be supported.

Features:

- Request modal with project type, description, budget, deadline, and reference links.
- Live commission slot counter.
- Numbered quotes.
- Quote acceptance, rejection, and change requests.
- Invoice generation.
- Configurable payment instructions.
- Paid/unpaid status.
- Portfolio entries with images, descriptions, and tags.
- Reviews after delivery.
- Average review score.
- Commission status notifications.

Only authorised staff can change invoice payment status or the commission workflow.

---

# 5. Lyss Guard — Complete Feature Plan

Lyss Guard is responsible for moderation, server logging, and anti-spam.

## 5.1 Logging

Support logs for:

- Member joins and leaves.
- Account age at join.
- Nickname changes.
- Role additions and removals.
- Message edits.
- Message deletions.
- Bulk message deletions.
- Bans and unbans.
- Channel creation, deletion, and updates.
- Role creation, deletion, and updates.
- Moderation actions.

Audit-log lookups are used where available to identify the responsible moderator.

Logs should be configurable by category or sent to a shared log channel.

## 5.2 Moderation commands

```text
/warn
/warnings
/unwarn
/timeout
/untimeout
/kick
/ban
/tempban
/unban
/purge
/slowmode
/lock
/unlock
/note add
/note list
/note remove
/history
/case view
/case reason
```

Every moderation action creates a case with:

- Case number.
- Target.
- Moderator.
- Action.
- Reason.
- Duration, if applicable.
- Creation time.
- Expiry time, if applicable.

Warnings can have configurable expiry.

Default escalation:

- Three active warnings: one-hour timeout.
- Five active warnings: 24-hour timeout.

These thresholds must be configurable and should not accidentally apply twice to the same action.

The bot must enforce role hierarchy, reject invalid durations, require reasons where appropriate, and protect the server owner and higher-ranking members.

## 5.3 Anti-spam

Commands:

```text
/antispam toggle
/antispam config
/antispam whitelist
/antispam status
```

Initial configurable defaults:

- Five messages in five seconds.
- Three identical messages in 30 seconds.
- Five or more unique mentions in one message.
- Unapproved Discord invite links.
- Optional excessive caps and emoji detection.

Escalation:

1. Delete spam and issue a brief warning.
2. Repeated offence: create a warning case and apply a five-minute timeout.
3. Further offence: escalate to a one-hour timeout.

Staff, bots, and explicitly whitelisted channels or roles can be exempted.

Anti-spam must log actions and avoid repeatedly punishing the same burst of messages.

---

# 6. Lyss Community — Complete Feature Plan

Lyss Community combines the original community-management features with a full persistent game system.

It is responsible for:

- Welcome messages.
- Boost notifications.
- Auto roles.
- Suggestions.
- Giveaways.
- Polls.
- Starboard.
- Birthdays.
- Embed builder.
- Economy.
- Jobs.
- Mini-games.
- Pets.
- Progression.
- Shop.
- Custom roles.
- Boosters.
- Profiles.
- Achievements.
- Quests.
- Inventory.
- Trading.
- Events.

All game data is stored in `community.db`.

## 6.1 Economy rules

The currency is **Lyss Coins**, abbreviated **LC**.

Each member has:

- Wallet balance.
- Bank balance.
- Lifetime coins earned.
- Lifetime coins spent.
- Current economy level.
- Economy XP.
- Daily reward streak.
- Work statistics.
- Game statistics.
- Transaction history.

The wallet is used for most transactions and games. The bank stores money separately and may be protected from robbery mechanics.

All balances are integer amounts. Negative balances are forbidden.

### Economy commands

| Command | Description |
|---|---|
| `/balance [user]` | View wallet, bank, and net worth |
| `/daily` | Claim daily coins |
| `/weekly` | Claim weekly coins |
| `/monthly` | Claim a monthly reward |
| `/work` | Start an interactive job |
| `/work jobs` | Browse available jobs |
| `/work stats` | View job levels and statistics |
| `/work leaderboard` | View the best workers |
| `/crime` | Attempt a risky virtual crime |
| `/rob @user` | Attempt a controlled virtual robbery |
| `/pay @user amount` | Transfer coins to a member |
| `/deposit amount` | Move coins from wallet to bank |
| `/withdraw amount` | Move coins from bank to wallet |
| `/leaderboard` | View richest members |
| `/economy` | Open the interactive economy dashboard |
| `/transactions [user]` | View transaction history |
| `/networth [user]` | View total wallet and bank value |
| `/richest` | View the wealth leaderboard |
| `/streak` | View daily reward streak |
| `/economy help` | Explain economy commands |

Administrative commands:

```text
/economy admin balance
/economy admin add
/economy admin remove
/economy admin set
/economy admin reset
/economy admin config
/economy admin freeze
/economy admin unfreeze
/economy admin audit
```

These commands require explicit owner or administrator permission. Every administrative balance adjustment must include a reason and be recorded in the audit log.

### Initial reward balancing

Suggested starting values:

| Activity | Example reward |
|---|---:|
| Daily reward | 500 LC |
| Weekly reward | 3,500 LC |
| Monthly reward | 15,000 LC |
| Basic job | 100–300 LC |
| Difficult job | 250–600 LC |
| Daily quest | 250–1,000 LC |
| Weekly quest | 2,000–7,500 LC |

These are configuration defaults for testing, not fixed promises. They should be adjusted after observing the economy.

### Daily rewards

`/daily` shows:

- Current streak.
- Available reward.
- Time until the next claim.
- Streak bonus.
- Claim button.

A streak bonus should increase gradually and have a cap.

Use a defined server timezone for reset calculations. Store claim timestamps in UTC, and never allow repeated claims by changing the server timezone or restarting the bot.

### Weekly and monthly rewards

These follow the same pattern but use separate claim records.

Rewards should be large enough to feel valuable without making normal jobs or shop prices irrelevant.

### Transfers

`/pay @user amount` requires a positive amount and a valid recipient.

The bot should:

1. Validate the amount.
2. Check the sender's available balance.
3. Show a confirmation.
4. Atomically debit and credit both accounts.
5. Record the transfer.
6. Show the final balances.

Transfers to the bot, invalid accounts, and self-transfers are rejected unless a specifically documented feature permits them.

### Bank

Deposits and withdrawals move money between a member's wallet and bank.

These are transfers within the same account, not new currency creation.

A transaction must not create money or destroy money through rounding errors.

### Crime and robbery

`/crime` offers random scenarios with a potential reward or fine.

`/rob @user` may target only eligible members, with:

- Cooldowns.
- A maximum percentage or amount that can be stolen.
- Minimum victim balance.
- Protection from repeated targeting.
- Clear failure and success outcomes.
- A bank balance that cannot be stolen by default.
- A transaction record for every outcome.

Do not allow users to bypass cooldowns by changing accounts or using multiple simultaneous requests.

---

# 7. Interactive `/work` System

The work system should be a major feature, not a command that simply returns a random number.

## 7.1 How it works

When a member uses `/work`, the bot presents a job card with:

- Job title.
- Difficulty.
- Expected reward range.
- XP reward.
- Energy or attempt cost, if enabled.
- A short description.
- **Start Job** and **Choose Another** buttons.

Once started, the member receives an interactive task.

The job has a deadline, an attempt limit, and a defined outcome. The bot validates the result server-side.

The player receives a reward based on performance, difficulty, and their job level.

## 7.2 Jobs

### A. Chef

The member must assemble an order.

Example:

> **Kitchen Rush**
>
> Customer order: Burger, Fries, Lemonade.
>
> Choose the correct items in the right order before time runs out.

Mechanics:

- Select the correct ingredients.
- Complete orders before the timer expires.
- Difficult orders grant more XP.
- Repeatedly incorrect answers reduce the reward.

### B. Miner

The member receives a small grid of hidden blocks.

They choose blocks to mine.

Possible discoveries:

- Stone.
- Coal.
- Iron.
- Gold.
- Diamonds.
- Rare relics.

The member has limited mining attempts. Better discoveries award bonus coins or crafting materials.

### C. Fisher

The player casts a line and must react when the catch indicator appears.

Possible catches include common fish, rare fish, treasure, and junk.

A timing-based interaction determines the quality of the catch.

### D. Delivery Driver

The player receives a delivery destination and must choose the correct route.

The task can contain multiple-choice directions or a simple route puzzle.

Faster completion provides a small performance bonus.

### E. Hacker

The player solves a fictional code puzzle.

Examples:

- Decode a short pattern.
- Identify the missing symbol.
- Solve a sequence.
- Find a logic error.

This is a harmless fictional puzzle mechanic, not an actual system-access feature.

### F. Detective

The bot provides clues about a fictional incident.

The member must identify the correct suspect or explanation.

Difficulty increases with the number of clues and possible answers.

### G. Courier

The member sorts packages by destination or category.

A timer and increasing difficulty create an arcade-style challenge.

### H. Blacksmith

The player follows a crafting sequence by selecting the correct materials or actions.

A better sequence produces better rewards.

### I. Gardener

The player chooses which plants to water, harvest, or protect.

Rare plants can provide crafting materials.

### J. Treasure Hunter

The member receives a small map and a limited number of moves to locate hidden treasure.

Rewards can include coins, materials, and collectibles.

### K. Barista

The player must prepare a drink using the correct sequence of ingredients.

More complicated orders award more XP.

### L. Pet Caretaker

The player completes a quick animal-care challenge.

This job can reward pet XP items and small amounts of coins.

## 7.3 Job progression

Every job has its own level and XP.

Example:

| Job level | Unlock |
|---|---|
| 1 | Basic tasks |
| 5 | Better reward range |
| 10 | Intermediate difficulty |
| 20 | Rare task variants |
| 30 | Advanced tasks |
| 50 | Exclusive title and cosmetic |

Members can level multiple jobs independently.

A job should have a configurable cooldown and a maximum active session count of one per player.

## 7.4 `/work` anti-exploit rules

- Rewards are granted only once per completed job.
- Each session receives a unique ID.
- The database stores the session state.
- Expired sessions cannot be completed.
- A player cannot submit another answer after the session is closed.
- Rewards are validated on the server.
- Button clicks from another user are rejected.
- Repeated invalid answers are rate-limited.
- All reward calculations are centralised in `jobService.js`.

---

# 8. Mini-Games — Complete Command List

Mini-games should use interactive Discord components wherever they improve the experience.

Every game has a defined rule set, payout calculation, cooldown, session expiry, and anti-exploit protections.

## 8.1 Coinflip

Command:

`/coinflip amount choice`

Example:

`/coinflip amount:500 choice:heads`

Features:

- Heads and tails buttons.
- Animated-style reveal.
- Configurable stake limits.
- Win/loss history.
- Optional duel mode.
- Daily and weekly statistics.

For an even-money game, a winning 500 LC bet returns the original 500 LC plus 500 LC profit. A losing bet loses the 500 LC stake.

The payout must be shown before confirmation.

## 8.2 Dice

Commands:

```text
/dice
/dice duel @user
```

Members roll a virtual die against the bot or another member.

The duel mode can use a fixed number of rounds and a clear winner.

## 8.3 Blackjack

Command:

`/blackjack amount`

Features:

- Hit.
- Stand.
- Double down, if enabled.
- Dealer logic.
- Natural blackjack payout.
- Bust and draw handling.
- Configurable table limits.

The bot must enforce game rules server-side and prevent a player from changing a completed hand.

## 8.4 Slots

Command:

`/slots amount`

A slot machine displays a random combination of symbols.

Example symbols:

- 🍒 Cherry.
- 🍋 Lemon.
- 🔔 Bell.
- ⭐ Star.
- 💎 Diamond.
- 7️⃣ Seven.

The payout table must be visible and configured centrally.

## 8.5 Roulette

Command:

`/roulette amount choice`

Supported choices may include:

- Red.
- Black.
- Odd.
- Even.
- Specific number.

The game must show its payout table and use a single validated outcome per session.

## 8.6 Higher or Lower

Command:

`/higherlower`

The player guesses whether the next number is higher or lower than the current number.

Optional streak mode increases the potential reward but ends when the player guesses incorrectly or cashes out.

## 8.7 Rock, Paper, Scissors

Command:

`/rps`

Features:

- Rock, paper, and scissors buttons.
- Bot opponent.
- Optional wager.
- Best-of-three mode.
- Player-versus-player challenges.

## 8.8 Trivia

Command:

`/trivia`

Categories:

- General knowledge.
- Gaming.
- Minecraft.
- Technology.
- Science.
- Geography.
- Entertainment.

Members receive coins and XP for correct answers.

Questions must be drawn from a curated dataset or a configured source. Avoid repeating the same question to the same member excessively.

## 8.9 Quick Maths

Command:

`/quickmath`

The player solves a randomly generated equation before the timer expires.

Difficulty determines the reward and XP.

## 8.10 Guess the Number

Command:

`/guess`

The bot selects a hidden number within a defined range.

The player receives a limited number of attempts and higher rewards for harder ranges.

## 8.11 Scratch Cards

Command:

`/scratchcard`

The player buys or claims a virtual scratch card and reveals the result.

Each card has a defined reward table.

## 8.12 Daily Spin

Command:

`/dailyspin`

The player spins a virtual reward wheel.

Possible outcomes:

- Coins.
- Job XP.
- Pet XP.
- Crafting materials.
- Cosmetic vouchers.
- Small boosters.

A daily claim limit applies.

## 8.13 Duels

Command:

`/duel @user amount`

Both players confirm the same stake before the game starts.

The game must reserve both stakes and release or settle them exactly once.

If a player declines, times out, or leaves the server, the stake reservation is released according to the session rules.

## 8.14 Multiplayer Dice

Command:

`/dice duel @user`

Players roll against each other.

Tie handling and rematches must be defined before stakes are accepted.

## 8.15 Word Guess

Command:

`/wordguess`

The bot presents a word puzzle with a limited number of attempts.

Correct answers grant coins and progression XP.

## 8.16 Memory Match

Command:

`/memory`

The member matches hidden symbols using a button grid.

The score depends on successful matches and the number of moves used.

## 8.17 Pattern Challenge

Command:

`/pattern`

The bot shows a sequence of symbols or numbers.

The player identifies the missing item or next item.

## 8.18 Unscramble

Command:

`/unscramble`

The bot scrambles a word, and the member must reconstruct it.

Difficulty and response time determine the reward.

## 8.19 Reaction Challenge

Command:

`/reaction`

The member must click the correct button after the challenge begins.

The bot rejects early clicks and calculates the response time using server timestamps.

## 8.20 Fishing Mini-Game

Command:

`/fish`

A dedicated fishing activity that uses the player's rod, bait, and fishing level.

It can be integrated with the Fisher job, while maintaining its own progression and rewards.

## 8.21 Treasure Hunt

Command:

`/treasure`

The player searches a grid or follows clues to find a hidden reward.

Rare discoveries can include collectibles and crafting materials.

## 8.22 Pet Battle

Command:

`/pet battle @user`

Two members select eligible pets and compete using a defined turn-based battle system.

Pet statistics and abilities determine the outcome.

Battles should be balanced so rare pets provide variety without making all lower-rarity pets useless.

## 8.23 Game dashboard

`/games` opens a paginated game menu.

Categories:

- Casino-style virtual games.
- Puzzle games.
- Reaction games.
- Multiplayer games.
- Pet games.
- Daily games.

The dashboard displays each game's rules, cooldown, minimum stake where relevant, and available modes.

## 8.24 Mini-game safety and integrity

All random outcomes must be generated server-side.

The bot must:

- Validate stakes.
- Prevent negative amounts.
- Lock the session before settlement.
- Reject duplicate button clicks.
- Reject interactions from non-participants.
- Expire abandoned games.
- Return reserved stakes when a game is cancelled without a valid result.
- Record completed games and payouts.
- Avoid making unsupported claims that an outcome is cryptographically provably fair.

---

# 9. Pet Collection System

The pet system is a persistent collection and progression feature.

Members can adopt pets, collect variants, train them, send them on expeditions, unlock cosmetics, and use eligible pets in battles.

## 9.1 Pet commands

```text
/pet
/pet adopt
/pet profile
/pet collection
/pet equip
/pet rename
/pet feed
/pet play
/pet train
/pet sleep
/pet explore
/pet expedition
/pet evolve
/pet abilities
/pet stats
/pet cosmetics
/pet equip-cosmetic
/pet rename-reset
/pet release
/pet leaderboard
/pet battle
```

The root `/pet` command opens the pet dashboard.

### Command descriptions

- `/pet adopt`: Adopt an available starter pet or use an eligible adoption item.
- `/pet profile`: View the selected pet's stats and appearance.
- `/pet collection`: Browse every owned pet.
- `/pet equip`: Select the active pet.
- `/pet rename`: Set a custom pet name.
- `/pet feed`: Feed the pet using an eligible inventory item.
- `/pet play`: Increase happiness and potentially earn pet XP.
- `/pet train`: Train a specific stat or ability.
- `/pet sleep`: Recover energy.
- `/pet explore`: Start an exploration activity.
- `/pet expedition`: Choose a destination and expedition duration.
- `/pet evolve`: Evolve an eligible pet.
- `/pet abilities`: View its abilities.
- `/pet stats`: View numerical attributes.
- `/pet cosmetics`: Browse owned pet accessories.
- `/pet equip-cosmetic`: Equip an accessory.
- `/pet release`: Release a pet after a confirmation warning.
- `/pet leaderboard`: View pet progression rankings.
- `/pet battle`: Start an eligible pet battle.

Releasing a pet is irreversible only after explicit confirmation. It must never happen through an accidental button click.

## 9.2 Pet rarities

Suggested rarity levels:

1. Common.
2. Uncommon.
3. Rare.
4. Epic.
5. Legendary.
6. Mythic.

Rarity affects appearance, availability, and possible traits. It must not be the only factor determining usefulness.

## 9.3 Starter pets

Examples:

| Pet | Rarity | Theme |
|---|---|---|
| Meadow Bunny | Common | Friendly starter |
| Copper Fox | Uncommon | Explorer |
| Lucky Slime | Uncommon | Fortune |
| Ember Fox | Rare | Adventure |
| Frost Penguin | Rare | Winter |
| Shadow Cat | Epic | Stealth |
| Baby Dragon | Legendary | Fire |
| Celestial Unicorn | Mythic | Magical |

The exact pet catalogue and artwork can be expanded later.

## 9.4 Pet profile card

A pet profile should show:

- Pet name.
- Species and variant.
- Rarity.
- Level and XP bar.
- Happiness.
- Energy.
- Health or battle condition, if applicable.
- Traits.
- Abilities.
- Equipped cosmetics.
- Evolution stage.
- Adoption date.

Buttons:

- Feed.
- Play.
- Train.
- Explore.
- Equip.
- Collection.

The owner of the pet is the only person allowed to use management buttons.

## 9.5 Pet needs

Pets may have happiness and energy systems, but these must remain friendly rather than punishing.

- Feeding can improve happiness.
- Playing increases happiness and can award XP.
- Training consumes energy.
- Sleeping restores energy.
- Expeditions use energy.
- Energy recovers over time.

Pets never permanently die because a member was inactive. Missed feeding must not destroy a pet or permanently remove progression.

## 9.6 Pet levelling

Pets gain XP through:

- Playing.
- Training.
- Expeditions.
- Quests.
- Eligible events.
- Pet battles.
- Special items.

Level-ups can unlock:

- New abilities.
- Additional cosmetic slots.
- Evolution opportunities.
- Higher expedition tiers.
- Profile badges.

## 9.7 Pet evolution

Eligible pets evolve after meeting specified requirements.

Requirements can include:

- Minimum pet level.
- Evolution material.
- Coins.
- A completed quest.
- A particular trait or achievement.

Evolution should preserve the pet's identity and existing progression.

## 9.8 Expeditions

Members choose a destination and send an eligible pet away for a defined duration.

| Destination | Example duration | Possible rewards |
|---|---:|---|
| Enchanted Forest | 10 minutes | Coins, herbs, common collectibles |
| Frozen Mountains | 30 minutes | Rare materials, winter collectibles |
| Dragon's Lair | 60 minutes | High-tier materials, dragon-themed items |
| Ancient Ruins | 45 minutes | Relics, puzzle fragments |
| Starfall Valley | 90 minutes | Rare cosmetics, special collectibles |

Rewards are calculated from configured tables and may depend on pet level, traits, and destination difficulty.

A completed expedition can be claimed once only.

## 9.9 Pet collection

Members should be able to filter collections by:

- Rarity.
- Species.
- Level.
- Evolution stage.
- Event.
- Owned or unowned.
- Equipped status.

The collection interface uses pagination and displays progress toward collection milestones.

## 9.10 Pet trading

Pet trading is part of the general trade system.

The bot must lock both pets during a confirmed trade, prevent a pet from being traded twice, and update ownership atomically.

Bound, event-exclusive, or non-tradable pets must be clearly marked.

---

# 10. Progression System

The progression system connects economy activity, pets, games, jobs, quests, and achievements.

## 10.1 Member levels

Members earn progression XP from approved activities.

Examples:

- Completing jobs.
- Finishing quests.
- Playing puzzle games.
- Winning eligible challenges.
- Completing collection milestones.
- Participating in special community events.

Rewards may include:

- Coins.
- Profile titles.
- Cosmetic items.
- Shop discounts.
- Badges.
- Special quest access.
- Customisation options.

The system must use a central XP service so the same activity cannot accidentally award XP twice.

## 10.2 Progression commands

```text
/level
/xp
/progression
/progression leaderboard
/progression rewards
/progression history
```

These display:

- Current level.
- Current XP.
- XP required for the next level.
- Total lifetime XP.
- Recent progression rewards.
- Available unlocks.

## 10.3 Economy levels

Economy levels track engagement with the economy.

They can be based on eligible jobs, quests, and other activities rather than simply how much money a player holds.

This prevents members from becoming permanently dominant solely because they have accumulated a large balance.

## 10.4 Job levels

Every job has its own progression track.

A member can be a level 20 Miner but a level 3 Chef.

## 10.5 Pet levels

Every pet has an independent level and XP total.

## 10.6 Seasonal progression

A seasonal progression track can be introduced later.

Members earn seasonal XP and unlock rewards during a defined period.

Seasonal rewards may include:

- Titles.
- Cosmetics.
- Profile backgrounds.
- Pet accessories.
- Collectible cards.
- Seasonal badges.

Permanent collection items remain in the member's account after a season ends.

## 10.7 Progression integrity

XP must be awarded only for eligible actions.

Spam, repeated self-interactions, duplicate event claims, and failed actions should not generate unlimited XP.

All XP sources and reward multipliers must be configured centrally.

---

# 11. Interactive Shop

The shop is one of the Community bot's main interfaces.

`/shop` opens a paginated, interactive catalogue.

## 11.1 Shop categories

### Pets

- Starter pets.
- Rare pets.
- Pet eggs.
- Evolution materials.
- Special event pets.

### Cosmetics

- Profile backgrounds.
- Profile borders.
- Titles.
- Badges.
- Display effects.
- Pet accessories.
- Collectible frames.

### Custom Discord roles

Members can purchase eligible cosmetic roles using Lyss Coins.

Examples:

- A custom role name.
- An approved role colour.
- A temporary highlighted role.
- A themed seasonal role.
- A profile-themed role.
- A role from a predefined cosmetic catalogue.

### Boosters

- Job XP booster.
- Pet XP booster.
- Quest XP booster.
- Temporary bonus reward booster.
- Exploration reward booster.

### Collectibles

- Cards.
- Trophies.
- Seasonal souvenirs.
- Rare decorations.
- Special event collectibles.

### Utility items

- Eligible crafting materials.
- Pet food.
- Training items.
- Expedition items.
- Cosmetic vouchers.

Gameplay items must be clearly separated from cosmetics so players understand what each item does.

## 11.2 Shop interface

Each product card contains:

- Item name.
- Image or emoji.
- Description.
- Rarity.
- Price.
- Stock information, if limited.
- Purchase restrictions.
- Preview button.
- Buy button.

The purchase process is:

1. Member selects a product.
2. The bot verifies eligibility.
3. The bot checks the balance and stock.
4. The bot shows a purchase confirmation.
5. The member confirms.
6. The bot atomically deducts coins and grants the item.
7. The bot records the transaction.
8. The inventory and profile are updated.

If any step fails, the transaction must roll back completely.

## 11.3 Shop commands

```text
/shop
/shop pets
/shop cosmetics
/shop roles
/shop boosters
/shop collectibles
/shop items
/shop search
/shop preview
/shop history
/inventory
/inventory use
/inventory inspect
```

Administrative commands:

```text
/shop admin add
/shop admin edit
/shop admin remove
/shop admin stock
/shop admin price
/shop admin rotate
/shop admin category
/shop admin disable
/shop admin audit
```

Only authorised staff may manage products and prices.

## 11.4 Daily rotating shop

A rotating catalogue can feature a selection of products that refreshes at a configured time.

The system should:

- Store the rotation in the database.
- Keep the same rotation after a restart.
- Clearly display the reset time.
- Prevent repeated purchase exploits.
- Avoid removing items that members already own.
- Preserve limited-stock accounting.

## 11.5 Mystery items

Mystery boxes can be added as an optional feature.

Their reward tables and odds must be clearly displayed before purchase.

Duplicate protection or duplicate exchange options should be considered so collecting items remains enjoyable.

---

# 12. Custom Discord Role Shop

This is a specialised shop category because it modifies real Discord server roles.

## 12.1 Purchase types

Support three configurable types:

**A. Fixed cosmetic roles**

Pre-created roles with predefined names and colours.

**B. Custom-name roles**

Members purchase permissionless cosmetic roles and choose a name subject to server rules.

**C. Custom-colour roles**

Members select an approved colour from a palette.

A custom role may combine name and colour if the server configuration permits it.

## 12.2 Commands

```text
/roleshop
/roleshop browse
/roleshop preview
/roleshop buy
/roleshop myrole
/roleshop rename
/roleshop recolor
/roleshop renew
/roleshop remove
```

Administrative commands:

```text
/roleshop admin configure
/roleshop admin palette
/roleshop admin price
/roleshop admin duration
/roleshop admin revoke
/roleshop admin audit
```

## 12.3 Role creation rules

The bot must:

- Create roles with no moderation or administrative permissions.
- Place purchased roles below staff and protected roles.
- Validate names and colours.
- Prevent duplicate role purchases where configured.
- Enforce a maximum number of custom roles per member.
- Enforce a maximum number of roles the system can create.
- Log every creation, modification, and deletion.
- Remove or expire roles according to the purchase terms.
- Never allow users to select permissions or positions above the bot's authority.

Role creation requires the bot's Manage Roles permission and correct role hierarchy.

## 12.4 Duration and ownership

A custom role may be permanent or temporary.

The shop must show the duration before purchase.

If temporary:

- The expiry date is recorded.
- The member can view the expiry.
- Optional renewal is supported.
- The role is removed when it expires.
- A failed role removal is logged for staff review.

Permanent roles remain until the owner removes them or an authorised administrator revokes them according to the server's policy.

---

# 13. Booster System

The project has two separate concepts called boosters. They must not be confused.

## 13.1 Virtual gameplay boosters

Purchased or earned items that temporarily improve eligible game rewards.

Commands:

```text
/boosters
/boosters inventory
/boosters use
/boosters active
/boosters history
```

Examples:

| Booster | Effect |
|---|---|
| Job XP Booster | Increases eligible job XP |
| Pet XP Booster | Increases pet XP |
| Quest Booster | Increases eligible quest XP |
| Explorer Booster | Improves configured expedition rewards |
| Reward Booster | Adds a configured bonus to eligible rewards |

Each booster must have:

- Duration.
- Effect.
- Eligible activities.
- Stacking rules.
- Expiry timestamp.
- Usage restrictions.

The bot must not allow repeated application of the same booster to multiply rewards unintentionally.

## 13.2 Discord server boosts

The existing Community bot also tracks Discord Nitro server boosts.

Commands:

```text
/boost test
/boost toggle
/boost status
/boost rewards
```

When a member starts boosting:

- Post a thank-you embed.
- Show the booster and avatar.
- Display the server's total boost count.
- Show the current boost tier.
- Display configured perks.
- Optionally grant a configured booster role or reward.

When a member stops boosting, record the change. Do not automatically announce it publicly unless explicitly enabled.

Any economy rewards for server boosting should be configurable and should follow Discord's rules.

---

# 14. Member Profiles

`/profile` opens a personal profile card.

## 14.1 Profile information

Display:

- Discord avatar.
- Username.
- Custom display title.
- Member level.
- Economy level.
- Wallet balance.
- Bank balance.
- Net worth.
- Total jobs completed.
- Total mini-games played.
- Game win statistics.
- Current pet.
- Pet collection progress.
- Achievement count.
- Quest completion statistics.
- Selected profile background.
- Equipped badges.
- Member since date within the bot.

Sensitive or private statistics must respect member privacy settings.

## 14.2 Profile commands

```text
/profile
/profile @user
/profile edit
/profile title
/profile background
/profile border
/profile badges
/profile stats
/profile privacy
/profile reset
```

`/profile reset` must be a carefully confirmed action and must not silently delete a member's economy or pet data.

## 14.3 Profile customisation

Members can unlock or purchase:

- Backgrounds.
- Borders.
- Titles.
- Badges.
- Decorations.
- Pet display themes.

Cosmetics must be stored in inventory and equipped through a validated profile service.

The profile should use an embed with buttons and dropdowns, with an optional generated profile image introduced later if desired.

---

# 15. Achievements

Achievements reward members for reaching milestones.

## 15.1 Achievement categories

- Economy.
- Jobs.
- Mini-games.
- Pets.
- Collection.
- Quests.
- Social participation.
- Seasonal events.
- Community milestones.

## 15.2 Achievement commands

```text
/achievements
/achievements @user
/achievements progress
/achievements showcase
/achievements leaderboard
```

Administrative commands:

```text
/achievements admin create
/achievements admin edit
/achievements admin disable
/achievements admin grant
/achievements admin revoke
```

## 15.3 Example achievements

| Achievement | Requirement | Example reward |
|---|---|---|
| First Steps | Claim first daily reward | Starter badge |
| First Paycheck | Complete first job | Coins |
| Skilled Worker | Reach job level 10 | Worker title |
| Lucky Seven | Win seven eligible games | Badge |
| Pet Parent | Adopt a pet | Pet accessory |
| Dedicated Trainer | Train a pet 25 times | Pet XP item |
| Explorer | Complete ten expeditions | Explorer title |
| Collector | Own ten different pets | Profile decoration |
| Big Spender | Make first shop purchase | Coins or badge |
| Millionaire | Reach one million LC net worth | Exclusive title |
| Treasure Hunter | Find a rare expedition reward | Collectible |
| Quest Champion | Complete 100 quests | Special badge |
| Social Butterfly | Participate in configured community activities | Cosmetic |
| Seasonal Champion | Finish a seasonal challenge | Seasonal title |
| Completionist | Complete a defined collection of achievements | Rare cosmetic |

## 15.4 Achievement rewards

Possible rewards include:

- Coins.
- Titles.
- Badges.
- Profile backgrounds.
- Pet cosmetics.
- Collectibles.
- XP items.

Achievement rewards must be granted only once unless the achievement explicitly supports repeatable completion.

---

# 16. Quests and Missions

Quests connect the rest of the system.

## 16.1 Quest commands

```text
/quests
/quests daily
/quests weekly
/quests seasonal
/quests progress
/quests claim
/quests history
```

## 16.2 Daily quests

Examples:

- Complete three jobs.
- Play two puzzle games.
- Feed your pet.
- Complete one expedition.
- Earn a configured amount of coins.
- Make a shop purchase.
- Win an eligible duel.

## 16.3 Weekly quests

Examples:

- Complete 20 jobs.
- Finish 10 expeditions.
- Complete 15 mini-games.
- Level a pet.
- Collect three new items.
- Complete a set number of daily quests.

## 16.4 Seasonal quests

Seasonal quests may include:

- Collect event items.
- Complete a treasure hunt.
- Participate in community challenges.
- Discover limited-time pets.
- Complete a seasonal collection.

## 16.5 Quest design rules

Quest progress must be event-driven and stored persistently.

A single event must not increment the same objective twice.

Quest rewards are claimed through a transaction that checks eligibility, marks the quest as claimed, and grants rewards exactly once.

---

# 17. Inventory, Collectibles and Crafting

## 17.1 Inventory commands

```text
/inventory
/inventory inspect
/inventory use
/inventory equip
/inventory unequip
/inventory sort
/inventory search
```

The inventory includes:

- Pets.
- Pet food.
- Crafting materials.
- Cosmetics.
- Collectible cards.
- Boosters.
- Quest items.
- Event rewards.

Items should have a unique identifier, quantity where appropriate, rarity, ownership, and usage rules.

## 17.2 Collectible cards

Members can collect themed cards from events, quests, achievements, and approved shop products.

Card rarities can match the pet rarity system.

The collection interface displays:

- Owned cards.
- Unowned cards.
- Set completion.
- Rarity.
- Edition.
- Event source.

Duplicate cards may be exchanged for materials or kept as collectibles.

## 17.3 Crafting

Crafting can be introduced after the core economy and inventory are stable.

Commands:

```text
/craft
/craft recipes
/craft inspect
/craft create
/craft history
```

Recipes combine materials into:

- Pet accessories.
- Cosmetics.
- Profile decorations.
- Expedition equipment.
- Collectibles.

A crafting operation consumes the required materials and grants the result atomically.

---

# 18. Trading and Gifting

## 18.1 Commands

```text
/trade @user
/trade offer
/trade add
/trade remove
/trade review
/trade accept
/trade cancel
/trade history
/gift @user
/gift history
```

The interface lets both participants propose eligible items, pets, and coins.

## 18.2 Trade workflow

1. One member opens a trade.
2. The other member accepts the invitation.
3. Both members add eligible assets.
4. The bot displays the complete offer.
5. Each participant explicitly confirms the final offer.
6. Any change invalidates previous confirmations.
7. The bot validates ownership and balances.
8. The exchange is committed atomically.
9. The trade is marked completed.
10. Both members receive a receipt.

## 18.3 Trading safeguards

- Expiring trade offers.
- Maximum trade value settings if needed.
- No trading locked pets or items.
- No duplicate item transfers.
- No negative balances.
- No accepting a changed offer without reconfirmation.
- Complete trade logs.
- Optional administrator dispute review.

Gifts should be a simpler one-way transfer with a confirmation and transaction record.

---

# 19. Existing Lyss Community Features

The new game system must not remove the original community-management features.

## 19.1 Auto roles

Commands:

```text
/autorole add
/autorole remove
/autorole list
/autorole post
```

Members use an interactive role panel to toggle eligible roles.

Use buttons for small collections and a dropdown when there are too many roles for a practical button layout.

The bot must check its role hierarchy before attempting to grant roles.

## 19.2 Welcome messages

Commands:

```text
/welcome test
/welcome toggle
/welcome configure
```

Welcome messages include:

- Member mention.
- Member avatar.
- Member count.
- Account age.
- Links to rules, information, support, and role selection.
- Optional banner.

The bot should use a real message mention outside the embed when a notification is intended.

## 19.3 Suggestions

Commands:

```text
/suggest
/suggestion approve
/suggestion deny
/suggestion consider
/suggestion implemented
```

Features:

- Suggestion ID.
- Author.
- Suggestion text and optional image.
- Pending status.
- Upvote and downvote buttons.
- Optional discussion thread.
- Staff response.
- Author notification.
- Author deletion while pending.

Votes are stored so the bot can enforce one current vote per member.

## 19.4 Giveaways

Commands:

```text
/giveaway start
/giveaway end
/giveaway reroll
/giveaway cancel
/giveaway list
```

Features:

- Prize.
- Duration.
- Winner count.
- Optional required role.
- Entry button.
- Live entry count.
- Automatic ending.
- Winner eligibility recheck.
- Reroll support.
- Persistent state.

## 19.5 Polls

Commands:

```text
/poll
/poll end
```

Features:

- Question and options.
- Two to ten options.
- Single-choice or multiple-choice.
- Anonymous voting.
- Changeable votes.
- Live result bars.
- Automatic closure.
- Final result display.

## 19.6 Starboard

Configure the star threshold and destination channel.

The bot republishes eligible messages with:

- Author.
- Content.
- First image.
- Jump link.
- Current star count.

Self-stars do not count. The starboard channel and configured excluded channels are ignored.

The bot should handle reaction removal and update or remove starboard posts according to the configured threshold.

## 19.7 Birthdays

Commands:

```text
/birthday set
/birthday view
/birthday upcoming
/birthday admin set
/birthday admin remove
```

Features:

- One birthday per member.
- Member-set birthdays locked after saving.
- Staff correction controls.
- Configured timezone and announcement time.
- Combined announcements.
- Optional birthday role.
- Role removal after the configured period.
- Duplicate-announcement protection after restarts.

A birth year is optional. The bot must not calculate or disclose a member's age unless a year was provided and the member's privacy settings allow it.

## 19.8 Embed builder

Commands:

```text
/embed create
/embed edit
/embed template save
/embed template load
/embed template list
/embed template delete
```

The builder supports:

- Title.
- Description.
- Colour.
- Author.
- Footer.
- Thumbnail.
- Image.
- Fields.
- Preview.
- Channel selection.
- Template saving.

Only messages posted by the relevant bot can be edited by that bot.

---

# 20. Community Events

Random events make the server feel alive.

## 20.1 Event types

**Money Rain**

Members click a button to claim a limited virtual reward.

**Wild Pet Encounter**

Members participate in a challenge to discover a special pet or collectible.

**Treasure Hunt**

Members solve clues to find a virtual treasure.

**Mysterious Merchant**

A travelling shop offers a temporary catalogue of eligible items.

**Community Challenge**

The server works toward a collective goal, such as completing a certain number of jobs or quests.

**Double Reward Weekend**

Eligible activities grant a configured bonus.

## 20.2 Event commands

```text
/event
/event active
/event history
/event leaderboard
/event join
```

Administrative commands:

```text
/event admin create
/event admin start
/event admin stop
/event admin schedule
/event admin rewards
```

## 20.3 Event rules

- Events are stored in the database.
- Each event has an explicit start and end.
- Rewards are claimable only once per eligible participant.
- Scheduled events survive restarts.
- Event rewards are configured centrally.
- Announcements are sent only to configured channels.
- Events have per-user and global participation limits.

---

# 21. ALYSS — Complete AI Bot Plan

The original Lyss AI bot is renamed **ALYSS**.

The folder can remain `ai-bot/` to avoid unnecessary deployment and path changes. Its public name, avatar, status, help output, and embeds should display ALYSS.

ALYSS uses Groq through `groq-sdk`.

It remains independent of the other bots.

## 21.1 AI triggers

ALYSS responds when:

1. A member mentions the bot.
2. A member replies to one of its messages.
3. A member replies to another message and mentions ALYSS.
4. A member uses `/ask`.
5. A member speaks in a configured auto-reply channel.

Ignore bots, the bot itself, and messages beginning with `//`.

## 21.2 Commands

```text
/ask
/ai toggle
/ai channel enable
/ai channel disable
/ai autochannel add
/ai autochannel remove
/ai blacklist add
/ai blacklist remove
/ai blacklist list
/ai memory clear
/ai memory size
/ai memory toggle
/ai persona set
/ai status
/persona create
/persona edit
/persona delete
/persona list
```

`/ask` supports an optional private response. Private requests must not be inserted into public channel memory.

## 21.3 Personas

Built-in personas:

- Default.
- Casual.
- Professional.
- Funny.

Additional administrator-defined personas can be created.

Each persona has a name, description, prompt, optional model override, and configuration.

ALYSS should remain recognisable across personas and must not claim to be a real human.

## 21.4 Memory

Each channel maintains a separate rolling conversation history.

Defaults:

- Approximately 12 exchanges.
- Token-aware trimming.
- Six-hour inactivity expiry.

Memory should store only the information necessary for conversation continuity.

Users and administrators must have controls to clear or disable memory. Avoid storing secrets or unnecessary sensitive information.

## 21.5 Groq rate limits

ALYSS must support:

- A configurable primary model.
- A configurable fallback model.
- A request queue.
- Per-user cooldowns.
- Token-aware context limits.
- Timeouts.
- Handling for rate-limit responses.
- Limited retries.
- Friendly failure messages.

Model names must be verified against Groq's available model list when implementation begins rather than hardcoded based on an old assumption.

## 21.6 ALYSS and Community integration

ALYSS may provide conversational help about the Community bot.

Examples:

- Explain how to use `/work`.
- Explain the difference between wallet and bank.
- Explain how pet expeditions work.
- Recommend shop categories.
- Help a member understand an achievement.
- Explain the current rules of a mini-game.

However, **Lyss Community remains the source of truth**.

ALYSS must not fabricate balances, item stock, pet ownership, trade status, or rewards. If a live data integration is implemented later, it must use a narrow, authenticated read-only interface for queries and never give ALYSS unrestricted database access.

The original architecture's independence is preserved: Community still functions if ALYSS is offline.

---

# 22. Database Design

Each bot has a separate SQLite database.

The Community database requires the most tables because it owns all game data.

## 22.1 Shared tables

Each bot can use tables such as:

- `guild_config`
- `scheduled_tasks`
- `error_log`

Each database has its own migrations and schema version.

## 22.2 Tickets tables

- `tickets`
- `ticket_blacklist`
- `ticket_ratings`
- `commissions`
- `quotes`
- `invoices`
- `portfolio`
- `reviews`

## 22.3 Guard tables

- `mod_cases`
- `mod_notes`
- `antispam_config`
- `message_cache`

## 22.4 Community tables

### Core community

- `autoroles`
- `suggestions`
- `suggestion_votes`
- `giveaways`
- `giveaway_entries`
- `polls`
- `poll_votes`
- `starboard_entries`
- `birthdays`
- `embed_templates`

### Economy

- `economy_accounts`
- `economy_transactions`
- `daily_claims`
- `weekly_claims`
- `monthly_claims`
- `economy_config`
- `economy_audit_log`

### Jobs and games

- `job_definitions`
- `job_progress`
- `job_sessions`
- `game_sessions`
- `game_results`
- `game_statistics`
- `game_cooldowns`

### Pets

- `pets`
- `pet_species`
- `pet_traits`
- `pet_abilities`
- `pet_expeditions`
- `pet_battles`
- `pet_cosmetics`

### Progression

- `member_progression`
- `xp_transactions`
- `achievements`
- `member_achievements`
- `quests`
- `member_quests`
- `seasonal_progression`

### Shop and inventory

- `shop_products`
- `shop_rotations`
- `shop_stock`
- `inventory_items`
- `inventory_transactions`
- `boosters`
- `active_boosters`
- `custom_roles`
- `custom_role_expiries`

### Profiles and trading

- `member_profiles`
- `profile_cosmetics`
- `profile_badges`
- `trade_sessions`
- `trade_items`
- `trade_confirmations`
- `gift_history`

### Events and crafting

- `community_events`
- `event_participants`
- `event_rewards`
- `crafting_recipes`
- `crafting_history`
- `collectible_catalogue`
- `member_collectibles`

These are logical tables, not a requirement to create every table before its feature is implemented. Migrations should add tables in stages.

## 22.5 Economy transactions

Every economy operation should record:

- Transaction ID.
- Member ID.
- Amount.
- Transaction type.
- Source.
- Destination where applicable.
- Timestamp.
- Related game, trade, or purchase ID.
- Status.
- Reason or metadata.

For balance changes, use SQLite transactions and database constraints.

A purchase, for example, must deduct currency and grant the item in the same transaction. If granting the item fails, the currency deduction must roll back.

## 22.6 Data retention

Define retention periods for:

- Error logs.
- Message caches.
- Completed game sessions.
- Old event records.
- Transaction history.
- Moderation cases.
- Ticket transcripts.

Do not delete economy or inventory history without an explicit retention policy and backup strategy.

---

# 23. Economy Integrity and Security

This section is mandatory for the game system.

## 23.1 Atomic transactions

All multi-step changes must be atomic.

Examples:

- Paying another member.
- Buying a shop item.
- Claiming a quest reward.
- Settling a coinflip.
- Completing a pet expedition.
- Accepting a trade.
- Creating a custom role after a purchase.

A failed operation must not leave the member with both the item and the refunded money.

## 23.2 Idempotency

Each reward operation must have a unique operation or session ID.

If a button is clicked twice or a scheduler retries a job, the system recognises the existing result and refuses to apply it again.

## 23.3 Cooldowns

Cooldowns must be stored persistently where necessary.

Restarting the bot must not reset daily rewards, work cooldowns, game cooldowns, or expedition completion rules.

## 23.4 Abuse controls

- Rate-limit command and button interactions.
- Reject negative amounts.
- Validate ownership.
- Validate user and guild IDs.
- Prevent simultaneous duplicate sessions.
- Record administrative adjustments.
- Set configurable betting limits.
- Use per-user limits for high-value activities.
- Detect abnormal reward patterns.
- Keep staff actions auditable.

## 23.5 Economy configuration

Provide owner-controlled settings for:

- Starting balance.
- Daily rewards.
- Weekly rewards.
- Work payouts.
- Game payout tables.
- Cooldowns.
- Betting limits.
- Transaction limits.
- Shop prices.
- Reward multipliers.
- Seasonal bonuses.
- Maximum wallet or bank balance, if desired.

Configuration changes should be validated and logged.

---

# 24. Discord Application Setup

Create four applications in the Discord Developer Portal.

## 24.1 Lyss Tickets

Required capabilities:

- Manage Channels.
- Manage Roles where necessary.
- Manage Messages where necessary.
- View Channels.
- Send Messages.
- Embed Links.
- Attach Files.
- Read Message History.
- Message Content intent for transcripts and ticket workflows.

## 24.2 Lyss Guard

Required capabilities:

- Kick Members.
- Ban Members.
- Moderate Members.
- Manage Messages.
- Manage Channels.
- View Audit Log.
- View Channels.
- Send Messages.
- Embed Links.
- Read Message History.
- Server Members intent.
- Message Content intent.

## 24.3 Lyss Community

Required capabilities:

- Manage Roles for autoroles and purchased custom roles.
- View Channels.
- Send Messages.
- Embed Links.
- Attach Files.
- Read Message History.
- Add Reactions.
- Create Public Threads where used.
- Use External Emojis where used.
- Server Members intent.
- Message Content intent where required by selected community features.

Economy, shop, games, pets, and profiles should use slash commands and interactions wherever possible, minimising unnecessary message-content access.

## 24.4 ALYSS

Required capabilities:

- View Channels.
- Send Messages.
- Send Messages in Threads.
- Read Message History.
- Embed Links.
- Use External Emojis where required.
- Message Content intent for mention, reply, and auto-reply behaviour.

ALYSS does not need moderation permissions.

## 24.5 Environment variables

Each bot receives its own environment file.

Common values:

```text
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=
OWNER_ID=
```

ALYSS additionally requires:

```text
GROQ_API_KEY=
GROQ_MODEL=
GROQ_FALLBACK_MODEL=
```

Never commit real tokens, keys, database files, or production environment files to Git.

---

# 25. Configuration and Setup Commands

Every bot has its own `/setup` interface.

## 25.1 Setup requirements

The setup system should collect:

- Required channel IDs.
- Role IDs.
- Categories.
- Error log destination.
- Feature-specific settings.
- Optional emojis.
- Timezone.
- Status rotation settings.

## 25.2 Setup verification

`/setup check` should report:

- Missing channels.
- Missing roles.
- Invalid IDs.
- Insufficient permissions.
- Incorrect role hierarchy.
- Missing environment variables where safe to report their presence or absence.
- Invalid category configuration.
- Database access problems.
- Unavailable optional features.

Never display the contents of secret environment variables.

## 25.3 Community setup checklist

The Community setup should include:

- Welcome channel.
- Boost announcement channel.
- Suggestion channel.
- Giveaway channel.
- Poll channel, if dedicated.
- Starboard channel.
- Birthday announcement channel.
- Rules and information links.
- Auto-role configuration.
- Moderator role configuration.
- Economy settings.
- Shop configuration.
- Custom-role category and limits.
- Event announcement channel.
- Profile and leaderboard settings.
- Default timezone.
- Error log channel.

---

# 26. Hosting and Deployment

The four bots can run on one small VPS or equivalent host, provided it has enough memory, persistent storage, and reliable backups.

## 26.1 PM2

Use PM2 to:

- Start all four bots.
- Restart crashed processes.
- Start processes on system boot.
- Keep separate logs.
- Restart individual bots during updates.

A deployment must not delete the `data/` directories.

## 26.2 Docker Compose alternative

Each bot can run in its own container with:

- A separate environment file.
- Persistent data volume.
- Restart policy.
- Restricted permissions.
- Centralised log collection where desired.

Do not run PM2 and Docker Compose as competing supervisors for the same process.

## 26.3 Backups

Create automatic backups of:

- Each SQLite database.
- Configuration files.
- Required asset files.
- Relevant deployment manifests.

Backups should be stored separately from the active data directory.

Use SQLite's backup facilities or a safe database backup method rather than copying a live database while it is being written.

## 26.4 Updates

A release process should:

1. Back up the relevant database.
2. Install pinned dependencies.
3. Run migration checks.
4. Run automated tests.
5. Deploy the changed bot.
6. Check logs and health.
7. Roll back the deployment if a critical failure occurs.

A code rollback must not blindly roll a database back to an incompatible schema.

---

# 27. Testing Requirements

Every feature must be tested before being enabled in a live server.

## 27.1 General tests

- Bot startup and shutdown.
- Command registration.
- Permission enforcement.
- Database connection.
- Restart recovery.
- Scheduler recovery.
- Error reporting.
- Invalid inputs.
- Missing configuration.
- Discord permission failures.

## 27.2 Economy tests

- Daily reward cannot be claimed twice.
- Negative payments are rejected.
- Insufficient funds are rejected.
- Simultaneous payments cannot overspend an account.
- A failed purchase refunds the balance automatically.
- A purchase cannot grant duplicate items accidentally.
- Administrative adjustments are logged.
- Game sessions settle exactly once.
- A restart does not reset cooldowns.

## 27.3 Pet tests

- A pet has one owner at a time.
- Pet XP is awarded once per eligible activity.
- Expeditions survive restarts.
- Completed expeditions cannot be claimed twice.
- Evolution preserves progression.
- Trading cannot duplicate pets.
- Expired sessions cannot modify pet data.

## 27.4 Shop tests

- Insufficient funds prevent purchases.
- Sold-out items cannot be bought.
- Limited stock cannot be oversold.
- Custom roles have no privileged permissions.
- Custom role expiry is handled correctly.
- Failed Discord role creation does not consume the purchase price permanently.
- A role cannot be created above the bot's hierarchy.

## 27.5 ALYSS tests

- Invalid API key.
- Rate limits.
- Provider outage.
- Fallback model.
- Memory expiry.
- Memory clearing.
- Private `/ask`.
- Message-length limits.
- Mention suppression.
- Ignored channels and users.

## 27.6 Ticket and moderation tests

- Ticket permissions.
- Duplicate ticket prevention.
- Transcript creation.
- Ticket closure and reopening.
- Role hierarchy.
- Temporary ban expiry.
- Warning escalation.
- Anti-spam cooldowns.
- Audit logs.

---

# 28. Complete Build Roadmap

The project should be built in phases so that every stage is usable and testable.

## Phase 1 — Shared foundation

Implement:

- Monorepo.
- Shared bootstrap.
- Command loader.
- Interaction router.
- Database wrapper.
- Migrations.
- Scheduler.
- Permission helpers.
- Error reporting.
- Embed factory.
- Setup system.
- Help and status commands.
- Deployment scripts.

**Completion requirement:** All four bots can start independently and respond to basic commands.

## Phase 2 — Lyss Tickets

Implement:

- Ticket panels.
- Ticket creation and permissions.
- Claiming and closing.
- Transcripts.
- Ratings.
- Inactivity handling.
- Blacklists.
- Ticket statistics.
- Commission requests.
- Quotes and invoices.
- Portfolio and reviews.

**Completion requirement:** The entire ticket lifecycle works without manual database editing.

## Phase 3 — Lyss Guard

Implement:

- Logging.
- Moderation cases.
- Warnings.
- Timeouts.
- Kicks and bans.
- Temporary bans.
- Channel tools.
- Notes and history.
- Anti-spam.
- Warning expiry.

**Completion requirement:** All moderation actions are permission-checked and auditable.

## Phase 4 — Community foundations

Implement:

- Auto roles.
- Welcome messages.
- Boost notifications.
- Suggestions.
- Giveaways.
- Polls.
- Starboard.
- Birthdays.
- Embed builder.

**Completion requirement:** The original Community features work before game complexity is introduced.

## Phase 5 — Economy

Implement:

- Wallet and bank.
- Daily, weekly, and monthly rewards.
- Payments.
- Deposits and withdrawals.
- Transactions.
- Leaderboards.
- Economy administration.
- Cooldowns.
- Economy dashboard.

**Completion requirement:** Economy transactions are atomic, logged, and restart-safe.

## Phase 6 — Interactive jobs

Implement:

- Job catalogue.
- Chef.
- Miner.
- Fisher.
- Delivery Driver.
- Hacker puzzles.
- Detective puzzles.
- Barista.
- Gardener.
- Treasure Hunter.
- Job XP and levels.

**Completion requirement:** Jobs are interactive, persistent, and cannot duplicate rewards.

## Phase 7 — Mini-games

Implement in this order:

1. Coinflip.
2. Dice.
3. Rock, Paper, Scissors.
4. Guess the Number.
5. Trivia.
6. Quick Maths.
7. Higher or Lower.
8. Slots.
9. Blackjack.
10. Roulette.
11. Scratch Cards.
12. Daily Spin.
13. Word Guess.
14. Memory Match.
15. Pattern Challenge.
16. Unscramble.
17. Reaction Challenge.
18. Multiplayer Duels.
19. Fishing.
20. Treasure Hunt.
21. Pet Battles.

**Completion requirement:** Each game has defined rules, cooldowns, payouts, expiry behaviour, and settlement tests.

## Phase 8 — Pets and progression

Implement:

- Starter pets.
- Pet collection.
- Pet profiles.
- Pet XP.
- Feeding and play.
- Energy.
- Training.
- Expeditions.
- Evolution.
- Pet cosmetics.
- Member levels.
- Job levels.
- Economy progression.

**Completion requirement:** Pets and progression persist across restarts and can be expanded through configuration.

## Phase 9 — Shop, inventory and custom roles

Implement:

- Interactive shop.
- Product catalogue.
- Inventory.
- Cosmetics.
- Collectibles.
- Pet items.
- Boosters.
- Role shop.
- Role creation.
- Role customisation.
- Temporary role expiry.
- Shop administration.

**Completion requirement:** Purchases and inventory changes are atomic and secure.

## Phase 10 — Profiles and achievements

Implement:

- Profile dashboard.
- Profile cosmetics.
- Titles and badges.
- Achievement catalogue.
- Achievement rewards.
- Achievement leaderboards.
- Daily and weekly quests.
- Quest rewards.
- Progression history.

**Completion requirement:** Progression and achievement rewards are awarded once and correctly displayed.

## Phase 11 — Events and social systems

Implement:

- Random events.
- Seasonal events.
- Treasure hunts.
- Community challenges.
- Collectible cards.
- Crafting.
- Gifts.
- Trading.
- Friendship features.
- Homes and decorations.
- Guilds, if desired.

**Completion requirement:** Event rewards and trades remain secure under concurrent use.

## Phase 12 — ALYSS

Implement:

- Groq integration.
- `/ask`.
- Mention and reply triggers.
- Auto-reply channels.
- Conversation memory.
- Personas.
- Rate limiting.
- Fallback models.
- Blacklists.
- Administrative controls.
- AI status and error reporting.

**Completion requirement:** ALYSS remains stable under rate limits and provider failures, and all four bots remain independent.

## Phase 13 — Final release

Complete:

- Full permissions audit.
- Database migration checks.
- Backup and restore tests.
- Load testing.
- Error-log review.
- Documentation.
- Deployment instructions.
- Environment variable templates.
- Command reference.
- Recovery instructions.
- Production configuration.

---

# 29. Final Command Organisation

The following is the intended command catalogue. Subcommands are grouped under their relevant slash-command roots where possible.

## Lyss Tickets

- `/setup`
- `/panel`
- `/ticket`
- `/ticketstats`
- `/commissions`
- `/commission`
- `/quote`
- `/invoice`
- `/portfolio`
- `/reviews`
- `/help`
- `/status`

## Lyss Guard

- `/setup`
- `/logs`
- `/warn`
- `/warnings`
- `/unwarn`
- `/timeout`
- `/untimeout`
- `/kick`
- `/ban`
- `/tempban`
- `/unban`
- `/purge`
- `/slowmode`
- `/lock`
- `/unlock`
- `/note`
- `/history`
- `/case`
- `/antispam`
- `/help`
- `/status`

## Lyss Community

### Community management

- `/setup`
- `/autorole`
- `/welcome`
- `/boost`
- `/suggest`
- `/suggestion`
- `/giveaway`
- `/poll`
- `/starboard`
- `/birthday`
- `/embed`

### Economy

- `/balance`
- `/daily`
- `/weekly`
- `/monthly`
- `/work`
- `/crime`
- `/rob`
- `/pay`
- `/deposit`
- `/withdraw`
- `/leaderboard`
- `/economy`
- `/transactions`
- `/networth`
- `/richest`
- `/streak`

### Games

- `/coinflip`
- `/dice`
- `/blackjack`
- `/slots`
- `/roulette`
- `/higherlower`
- `/rps`
- `/trivia`
- `/quickmath`
- `/guess`
- `/scratchcard`
- `/dailyspin`
- `/duel`
- `/wordguess`
- `/memory`
- `/pattern`
- `/unscramble`
- `/reaction`
- `/fish`
- `/treasure`
- `/games`

### Pets

- `/pet`

### Progression

- `/level`
- `/xp`
- `/progression`

### Shop and inventory

- `/shop`
- `/roleshop`
- `/boosters`
- `/inventory`

### Profiles and rewards

- `/profile`
- `/achievements`
- `/quests`

### Social and events

- `/trade`
- `/gift`
- `/event`
- `/craft`

### General

- `/help`
- `/status`

## ALYSS

- `/ask`
- `/ai`
- `/persona`
- `/help`
- `/status`

All commands must have explicit permission requirements, input validation, cooldown rules where applicable, and appropriate error handling.

---

# 30. Final Project Decisions

These are the project-wide decisions for implementation.

1. **Four independent bots:** Lyss Tickets, Lyss Guard, Lyss Community, and ALYSS.
2. **ALYSS replaces the public name Lyss AI.** The existing `ai-bot/` directory can remain unchanged internally.
3. **Lyss Community owns the economy.** No other bot can directly alter balances or inventory.
4. **All four bots use a shared code package**, but each maintains its own database and runtime.
5. **SQLite is the initial database choice**, with migrations and transaction-safe operations.
6. **The economy uses Lyss Coins (LC)** as virtual currency.
7. **Work is interactive**, with multiple job types, rewards, XP, and independent job levels.
8. **Mini-games use server-validated outcomes** and documented payout rules.
9. **Pets have progression, traits, cosmetics, and expeditions**, but cannot permanently die from inactivity.
10. **The shop supports pets, cosmetics, boosters, collectibles, and custom Discord roles.**
11. **Custom roles have no privileged permissions** and must obey Discord role hierarchy.
12. **Profiles, achievements, and quests are persistent.**
13. **All purchases, trades, rewards, and transfers are transaction-safe.**
14. **ALYSS can explain the game**, but it must not invent game state or become a privileged economy administrator.
15. **The original ticket, moderation, and community-management features remain part of the project.**
16. **Every bot has its own setup, help, status, and error-reporting systems.**
17. **Backups and restart recovery are part of the initial architecture**, not an afterthought.
18. **The project is built in phases**, with tests and a usable release at each stage.

## The intended end result

Lyss Tools should be a complete Discord bot ecosystem rather than four unrelated scripts.

- **Lyss Tickets** manages support and commissions.
- **Lyss Guard** protects and moderates the server.
- **Lyss Community** provides a persistent Discord game world with an economy, jobs, games, pets, progression, shops, profiles, achievements, and events.
- **ALYSS** provides the conversational AI experience.

The most important implementation rule is to build the shared foundation first, then complete the economy and its transaction system before adding features that depend on it. Once that foundation is stable, pets, shops, progression, achievements, and events can all build on the same reliable data layer.