import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSettingValue, parseSettingValue, validateStoredValue } from '../src/setupKit.js';

const HOUR = 3_600_000;

test('parses timezones', () => {
  assert.deepEqual(parseSettingValue({ type: 'timezone' }, 'Europe/London'), { value: 'Europe/London' });
  assert.ok(parseSettingValue({ type: 'timezone' }, 'Mars/Olympus').error);
});

test('normalises colours', () => {
  assert.deepEqual(parseSettingValue({ type: 'colour' }, 'c084fc'), { value: '#C084FC' });
  assert.ok(parseSettingValue({ type: 'colour' }, 'purple').error);
});

test('parses booleans', () => {
  assert.deepEqual(parseSettingValue({ type: 'boolean' }, 'on'), { value: true });
  assert.deepEqual(parseSettingValue({ type: 'boolean' }, 'Disabled'), { value: false });
  assert.ok(parseSettingValue({ type: 'boolean' }, 'maybe').error);
});

test('parses bounded integers', () => {
  const item = { type: 'integer', min: 1, max: 10 };
  assert.deepEqual(parseSettingValue(item, '5'), { value: 5 });
  assert.ok(parseSettingValue(item, '0').error);
  assert.ok(parseSettingValue(item, '11').error);
  assert.ok(parseSettingValue(item, '2.5').error);
  assert.ok(parseSettingValue(item, '').error);
});

test('parses bounded durations', () => {
  const item = { type: 'duration', min: HOUR, max: 48 * HOUR };
  assert.deepEqual(parseSettingValue(item, '1d 2h'), { value: 26 * HOUR });
  assert.ok(parseSettingValue(item, '30m').error);
  assert.ok(parseSettingValue(item, '3d').error);
  assert.ok(parseSettingValue(item, 'soon').error);
});

test('validates text and URLs', () => {
  assert.deepEqual(parseSettingValue({ type: 'text', maxLength: 5 }, ' hello '), { value: 'hello' });
  assert.ok(parseSettingValue({ type: 'text', maxLength: 5 }, 'too long').error);
  assert.ok(parseSettingValue({ type: 'url' }, 'javascript:alert(1)').error);
  assert.deepEqual(parseSettingValue({ type: 'url' }, 'https://example.com'), { value: 'https://example.com' });
});

test('rejects text values for channel and role settings', () => {
  assert.ok(parseSettingValue({ type: 'channel', label: 'Log' }, '123').error);
});

test('re-validates stored values', () => {
  const item = { type: 'duration', min: HOUR };
  assert.equal(validateStoredValue(item, 2 * HOUR), null);
  assert.ok(validateStoredValue(item, 1_000));
  assert.equal(validateStoredValue({ type: 'colour' }, '#FFFFFF'), null);
});

test('formats values for display', () => {
  assert.equal(formatSettingValue({ type: 'channel' }, '1'), '<#1>');
  assert.equal(formatSettingValue({ type: 'role' }, '2'), '<@&2>');
  assert.equal(formatSettingValue({ type: 'boolean' }, false), 'Off');
  assert.equal(formatSettingValue({ type: 'duration' }, 48 * HOUR), '2d');
  assert.equal(formatSettingValue({ type: 'text' }, undefined), null);
});
