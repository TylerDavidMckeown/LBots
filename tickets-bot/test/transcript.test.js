import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderContent, renderTranscript } from '../src/services/transcriptService.js';

const ticket = {
  id: 7, number: 12, type: 'support', opener_id: '111', created_at: Date.UTC(2026, 9, 23, 10), closed_at: Date.UTC(2026, 9, 23, 12), close_reason: 'Solved <b>', subject: 'Bot offline',
};

const message = (overrides = {}) => ({
  id: '1',
  authorId: '111',
  authorName: 'Alice',
  authorTag: 'alice',
  bot: false,
  avatarUrl: 'https://cdn.discordapp.com/avatars/111/a.png',
  createdAt: Date.UTC(2026, 9, 23, 10, 5),
  editedAt: null,
  content: 'Hello',
  embeds: [],
  attachments: [],
  mentions: { users: {}, roles: {}, channels: {} },
  ...overrides,
});

test('escapes HTML so message content cannot inject markup', () => {
  assert.equal(escapeHtml('<script>"x" & \'y\'</script>'), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
  const html = renderTranscript({ guildName: 'Lyss <Server>', ticket, messages: [message({ content: '<img src=x onerror=alert(1)>' })] });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Lyss &lt;Server&gt;/);
  assert.match(html, /Solved &lt;b&gt;/);
});

test('renders mentions as names and keeps line breaks', () => {
  const html = renderContent('Hi <@222> and <@!333> in <#444> for <@&555>\nthanks', {
    users: { 222: 'bob' }, roles: { 555: 'Support' }, channels: { 444: 'general' },
  });
  assert.equal(html, 'Hi <span class="mention">@bob</span> and <span class="mention">@333</span> in <span class="mention">#general</span> for <span class="mention">@Support</span><br>thanks');
});

test('only https links are rendered for attachments and avatars', () => {
  const html = renderTranscript({
    guildName: 'G',
    ticket,
    messages: [message({
      avatarUrl: 'javascript:alert(1)',
      attachments: [{ name: 'ok.png', url: 'https://cdn.discordapp.com/x/ok.png' }, { name: 'bad.png', url: 'javascript:alert(2)' }],
    })],
  });
  assert.match(html, /href="https:\/\/cdn\.discordapp\.com\/x\/ok\.png"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /bad\.png/);
});

test('includes ticket details, embeds and the message count', () => {
  const html = renderTranscript({
    guildName: 'G',
    ticket,
    messages: [message(), message({ id: '2', bot: true, authorName: 'Lyss Tickets', content: '', embeds: [{ title: 'Ticket closed', description: 'Bye', fields: [{ name: 'Reason', value: 'Solved' }] }] })],
  });
  assert.match(html, /Support ticket #0012/);
  assert.match(html, /<dt>Messages<\/dt><dd>2<\/dd>/);
  assert.match(html, /Ticket closed/);
  assert.match(html, /class="bot"/);
  assert.match(html, /Bot offline/);
});
