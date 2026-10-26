import fs from 'node:fs';
import path from 'node:path';
import { formatTicketNumber, ticketLabel } from './ticketTypes.js';

const MAX_MESSAGES = 5_000;

export function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text ?? '').replace(/[&<>"']/g, (c) => map[c]);
}

/** Escapes message text and turns Discord mentions into readable names. */
export function renderContent(content, mentions = {}) {
  const name = (table, id) => escapeHtml(mentions[table]?.[id] ?? id);
  return escapeHtml(content)
    .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => `<span class="mention">@${name('users', id)}</span>`)
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => `<span class="mention">@${name('roles', id)}</span>`)
    .replace(/&lt;#(\d+)&gt;/g, (_, id) => `<span class="mention">#${name('channels', id)}</span>`)
    .replace(/\n/g, '<br>');
}

function formatTime(ms) {
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

const safeUrl = (url) => (/^https:\/\//.test(url ?? '') ? escapeHtml(url) : null);

/** Plain data from a discord.js Message, so rendering can be tested without Discord. */
export function toTranscriptMessage(message) {
  const lookup = (collection, value) => Object.fromEntries([...collection.values()].map((item) => [item.id, value(item)]));
  return {
    id: message.id,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    authorTag: message.author.tag,
    bot: message.author.bot,
    avatarUrl: message.author.displayAvatarURL({ size: 64, extension: 'png' }),
    createdAt: message.createdTimestamp,
    editedAt: message.editedTimestamp,
    content: message.content,
    embeds: message.embeds.map((embed) => ({
      title: embed.title,
      description: embed.description,
      fields: embed.fields.map((field) => ({ name: field.name, value: field.value })),
    })),
    attachments: [...message.attachments.values()].map((a) => ({ name: a.name, url: a.url, size: a.size })),
    mentions: {
      users: lookup(message.mentions.users, (u) => u.username),
      roles: lookup(message.mentions.roles, (r) => r.name),
      channels: lookup(message.mentions.channels, (c) => c.name ?? c.id),
    },
  };
}

/** Fetches up to MAX_MESSAGES messages, oldest first. */
export async function fetchAllMessages(channel, max = MAX_MESSAGES) {
  const all = [];
  let before;
  while (all.length < max) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-max);
}

export function renderTranscript({ guildName, ticket, messages, generatedAt = Date.now() }) {
  const rows = messages.map((m) => {
    const embeds = m.embeds.map((e) => `
      <div class="embed">
        ${e.title ? `<div class="embed-title">${renderContent(e.title, m.mentions)}</div>` : ''}
        ${e.description ? `<div>${renderContent(e.description, m.mentions)}</div>` : ''}
        ${e.fields.map((f) => `<div class="field"><b>${renderContent(f.name, m.mentions)}</b><br>${renderContent(f.value, m.mentions)}</div>`).join('')}
      </div>`).join('');
    const attachments = m.attachments.map((a) => {
      const url = safeUrl(a.url);
      return `<div class="attachment">📎 ${url ? `<a href="${url}" rel="noopener noreferrer">${escapeHtml(a.name)}</a>` : escapeHtml(a.name)}</div>`;
    }).join('');
    const avatar = safeUrl(m.avatarUrl);
    return `
    <div class="message">
      ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : '<div class="avatar"></div>'}
      <div class="body">
        <div class="meta"><span class="author">${escapeHtml(m.authorName)}</span>${m.bot ? ' <span class="bot">BOT</span>' : ''}
          <span class="tag">${escapeHtml(m.authorTag)}</span> <span class="time">${formatTime(m.createdAt)}${m.editedAt ? ' (edited)' : ''}</span></div>
        ${m.content ? `<div class="content">${renderContent(m.content, m.mentions)}</div>` : ''}
        ${embeds}${attachments}
      </div>
    </div>`;
  }).join('');

  const title = `${ticketLabel(ticket)} — ${guildName}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; font: 15px/1.45 system-ui, sans-serif; background: #313338; color: #dbdee1; }
  header { padding: 20px 24px; background: #2b2d31; border-bottom: 1px solid #1e1f22; }
  h1 { margin: 0 0 8px; font-size: 20px; color: #f2f3f5; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; margin: 0; font-size: 13px; }
  dt { color: #949ba4; }
  dd { margin: 0; }
  main { padding: 8px 24px 32px; }
  .message { display: flex; gap: 12px; padding: 8px 0; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex: none; background: #1e1f22; }
  .body { min-width: 0; }
  .author { font-weight: 600; color: #f2f3f5; }
  .bot { font-size: 10px; background: #5865f2; color: #fff; padding: 1px 4px; border-radius: 3px; }
  .tag, .time { font-size: 12px; color: #949ba4; }
  .content { overflow-wrap: anywhere; }
  .embed { margin-top: 4px; padding: 8px 12px; border-left: 4px solid #c084fc; background: #2b2d31; border-radius: 4px; }
  .embed-title { font-weight: 600; color: #f2f3f5; }
  .field { margin-top: 6px; }
  .mention { background: rgba(88, 101, 242, .3); color: #c9cdfb; border-radius: 3px; padding: 0 2px; }
  .attachment a { color: #00a8fc; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <dl>
    <dt>Ticket</dt><dd>#${formatTicketNumber(ticket.number)} (${escapeHtml(ticket.type)})</dd>
    <dt>Opened by</dt><dd>${escapeHtml(ticket.opener_id)}</dd>
    <dt>Opened</dt><dd>${formatTime(ticket.created_at)}</dd>
    ${ticket.closed_at ? `<dt>Closed</dt><dd>${formatTime(ticket.closed_at)}</dd>` : ''}
    ${ticket.close_reason ? `<dt>Reason</dt><dd>${escapeHtml(ticket.close_reason)}</dd>` : ''}
    ${ticket.subject ? `<dt>Subject</dt><dd>${escapeHtml(ticket.subject)}</dd>` : ''}
    <dt>Messages</dt><dd>${messages.length}</dd>
    <dt>Generated</dt><dd>${formatTime(generatedAt)}</dd>
  </dl>
</header>
<main>${rows || '<p>No messages.</p>'}</main>
</body>
</html>
`;
}

/** Fetches the channel history, renders it and writes it under data/transcripts/<guild>/. */
export async function buildTranscript(ctx, guild, channel, ticket) {
  const messages = (await fetchAllMessages(channel)).map(toTranscriptMessage);
  const html = renderTranscript({ guildName: guild.name, ticket, messages });
  const dir = path.join(ctx.rootDir, 'data', 'transcripts', guild.id);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${ticket.type}-${formatTicketNumber(ticket.number)}-${ticket.id}.html`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, html);
  return { filePath, fileName, html, messageCount: messages.length };
}
