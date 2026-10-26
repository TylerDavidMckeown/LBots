import { SlashCommandBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import { UserError } from '@lyss/shared/errorReporter.js';
import { safeSend } from '@lyss/shared/utils/safeSend.js';
import { isValidTimezone } from '@lyss/shared/utils/time.js';
import { getServices } from '../services/index.js';
import { assignableProblem } from '../services/roles.js';
import { EPHEMERAL, fetchChannel } from './common.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Valid calendar date; 29 February is accepted without a year. Years cannot be in the future. */
export function isValidBirthday(month, day, year = null, now = new Date()) {
  const date = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  if (year !== null && (year < 1900 || date > now)) return false;
  return true;
}

/** 29 February birthdays are celebrated on 28 February in non-leap years. */
export function celebratesOn(birthday, month, day, isLeapYear) {
  if (birthday.month === month && birthday.day === day) return true;
  return !isLeapYear && birthday.month === 2 && birthday.day === 29 && month === 2 && day === 28;
}

/** The next local date (today included) this birthday is celebrated. */
export function nextOccurrence(birthday, from) {
  const on = (year) => {
    const day = birthday.month === 2 && birthday.day === 29 && !DateTime.local(year).isInLeapYear ? 28 : birthday.day;
    return from.set({ year, month: birthday.month, day }).startOf('day');
  };
  const thisYear = on(from.year);
  return thisYear < from.startOf('day') ? on(from.year + 1) : thisYear;
}

/** Age on a date, only when a birth year was given. */
export function ageOn(birthday, date) {
  if (!birthday.year) return null;
  const hadBirthday = date.month > birthday.month || (date.month === birthday.month && date.day >= birthday.day);
  return date.year - birthday.year - (hadBirthday ? 0 : 1);
}

export const formatBirthday = (b) => `${b.day} ${MONTHS[b.month - 1]}`;

const zoneOf = (ctx, guildId) => {
  const zone = ctx.guildConfig.get(guildId, 'timezone');
  return isValidTimezone(zone) ? zone : 'UTC';
};

function readDate(interaction) {
  const month = interaction.options.getInteger('month', true);
  const day = interaction.options.getInteger('day', true);
  const year = interaction.options.getInteger('year');
  if (!isValidBirthday(month, day, year)) throw new UserError('That is not a valid date.', { title: 'Invalid date' });
  return { month, day, year };
}

const dateOptions = (s) => s
  .addIntegerOption((o) => o.setName('month').setDescription('Month').setRequired(true).addChoices(...MONTHS.map((name, i) => ({ name, value: i + 1 }))))
  .addIntegerOption((o) => o.setName('day').setDescription('Day').setRequired(true).setMinValue(1).setMaxValue(31))
  .addIntegerOption((o) => o.setName('year').setDescription('Birth year (optional, never shown unless you allow it)').setMinValue(1900).setMaxValue(2100));

/** Posts one combined announcement per guild per local day, after the configured hour. */
export async function announceBirthdays(ctx, guild, now = DateTime.now()) {
  const { birthdays } = getServices(ctx);
  const channelId = ctx.guildConfig.get(guild.id, 'channel.birthdays');
  if (!channelId) return false;
  const local = now.setZone(zoneOf(ctx, guild.id));
  if (local.hour < ctx.guildConfig.get(guild.id, 'birthday.hour')) return false;
  const date = local.toISODate();
  const existing = birthdays.announcement(guild.id, date);
  if (existing?.posted_at) return false;
  if (!existing && !birthdays.claimAnnouncement(guild.id, date)) return false;

  const celebrating = birthdays.all(guild.id).filter((b) => celebratesOn(b, local.month, local.day, local.isInLeapYear));
  const members = [];
  for (const b of celebrating) {
    const member = await guild.members.fetch(b.user_id).catch(() => null);
    if (member) members.push({ member, birthday: b });
  }
  if (members.length) {
    const channel = await fetchChannel(ctx, channelId);
    const kit = ctx.embeds.for(guild.id);
    const lines = members.map(({ member, birthday }) => {
      const age = birthday.show_age ? ageOn(birthday, local) : null;
      return `🎂 ${member}${age ? ` is turning **${age}**` : ''}`;
    });
    await safeSend(channel, {
      content: members.map(({ member }) => `${member}`).join(' '),
      embeds: [kit.base({ title: '🎉 Happy birthday!', description: `${lines.join('\n')}\n\nWishing you a wonderful day!`, colour: 0xff73fa })],
      allowedMentions: { users: members.map(({ member }) => member.id) },
    }, { logger: ctx.logger });

    const roleId = ctx.guildConfig.get(guild.id, 'role.birthday');
    const role = roleId ? guild.roles.cache.get(roleId) : null;
    if (role && !(await assignableProblem(ctx, guild, role))) {
      const removeAt = Date.now() + ctx.guildConfig.get(guild.id, 'birthday.roleDuration');
      for (const { member } of members) {
        await member.roles.add(role, 'Birthday').catch(() => {});
        ctx.scheduler.schedule('birthday:role', removeAt, { guildId: guild.id, userId: member.id, roleId: role.id }, { dedupeKey: `birthday-role:${guild.id}:${member.id}:${date}` });
      }
    }
  }
  birthdays.markPosted(guild.id, date);
  return members.length > 0;
}

const command = {
  data: new SlashCommandBuilder().setName('birthday').setDescription('Birthdays')
    .addSubcommand((s) => dateOptions(s.setName('set').setDescription('Save your birthday (locked once saved)'))
      .addBooleanOption((o) => o.setName('show_age').setDescription('Show your age in announcements (needs a year)')))
    .addSubcommand((s) => s.setName('view').setDescription('See a birthday')
      .addUserOption((o) => o.setName('user').setDescription('Member (defaults to you)')))
    .addSubcommand((s) => s.setName('upcoming').setDescription('Upcoming birthdays'))
    .addSubcommandGroup((g) => g.setName('admin').setDescription('Correct birthdays')
      .addSubcommand((s) => dateOptions(s.setName('set').setDescription('Set or correct a member\'s birthday')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a member\'s birthday')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))),
  category: 'Community',
  tier: 'member',
  subcommandTiers: { 'admin set': 'moderator', 'admin remove': 'moderator' },
  async execute(interaction, ctx) {
    const { birthdays } = getServices(ctx);
    const guildId = interaction.guildId;
    const kit = ctx.embeds.for(guildId);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: EPHEMERAL });

    if (group === 'admin') {
      const user = interaction.options.getUser('user', true);
      if (sub === 'remove') {
        if (!birthdays.remove(guildId, user.id)) throw new UserError(`${user} has no saved birthday.`, { title: 'Not found' });
        return reply(kit.success('Birthday removed', `${user}'s birthday was removed.`));
      }
      const date = readDate(interaction);
      const existing = birthdays.get(guildId, user.id);
      birthdays.set({ guildId, userId: user.id, ...date, showAge: Boolean(existing?.show_age) && Boolean(date.year), setBy: interaction.user.id });
      return reply(kit.success('Birthday saved', `${user}'s birthday is now ${formatBirthday(date)}.`));
    }

    if (sub === 'set') {
      const existing = birthdays.get(guildId, interaction.user.id);
      if (existing?.locked) throw new UserError(`Your birthday is already saved as ${formatBirthday(existing)}. Ask a moderator if it needs correcting.`, { title: 'Birthday locked' });
      const date = readDate(interaction);
      const showAge = Boolean(interaction.options.getBoolean('show_age')) && Boolean(date.year);
      birthdays.set({ guildId, userId: interaction.user.id, ...date, showAge, setBy: interaction.user.id });
      return reply(kit.success('Birthday saved', `Your birthday is ${formatBirthday(date)}.${showAge ? ' Your age will be shown in announcements.' : ''}\nIt is now locked; a moderator can correct it if needed.`));
    }

    if (sub === 'view') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const birthday = birthdays.get(guildId, user.id);
      if (!birthday) throw new UserError(`${user.id === interaction.user.id ? 'You have' : `${user} has`} not saved a birthday.`, { title: 'No birthday' });
      const now = DateTime.now().setZone(zoneOf(ctx, guildId));
      const next = nextOccurrence(birthday, now);
      // Ages are private: only shown to the member themselves, or when they opted in.
      const age = birthday.show_age || user.id === interaction.user.id ? ageOn(birthday, next) : null;
      const days = Math.round(next.diff(now.startOf('day'), 'days').days);
      return reply(kit.base({ title: `🎂 ${user.username}'s birthday`, description: `${formatBirthday(birthday)} · ${days === 0 ? 'today! 🎉' : `in ${days} day${days === 1 ? '' : 's'}`}${age ? ` (turning ${age})` : ''}` }));
    }

    const now = DateTime.now().setZone(zoneOf(ctx, guildId));
    const upcoming = birthdays.all(guildId)
      .map((b) => ({ b, next: nextOccurrence(b, now) }))
      .sort((a, b) => a.next - b.next)
      .slice(0, 10);
    const lines = upcoming.map(({ b, next }) => `**${next.toFormat('d LLL')}** · <@${b.user_id}>${next.hasSame(now, 'day') ? ' 🎉 today' : ''}`);
    return interaction.reply({ embeds: [kit.base({ title: '🎂 Upcoming birthdays', description: lines.join('\n') || 'No birthdays saved yet. Add yours with `/birthday set`.' })], allowedMentions: { parse: [] } });
  },
};

export default {
  commands: [command],
  jobs: [
    {
      type: 'birthdays:check',
      every: 15 * 60_000,
      async execute(payload, task, ctx) {
        for (const guild of ctx.client.guilds.cache.values()) {
          try {
            await announceBirthdays(ctx, guild);
          } catch (error) {
            await ctx.errors.report(error, { source: 'job:birthdays:check', guildId: guild.id });
          }
        }
      },
    },
    {
      type: 'birthday:role',
      async execute({ guildId, userId, roleId }, task, ctx) {
        const guild = await ctx.client.guilds.fetch(guildId).catch(() => null);
        const member = await guild?.members.fetch(userId).catch(() => null);
        if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Birthday is over');
      },
    },
  ],
};
