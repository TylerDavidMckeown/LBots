// Removes secrets from anything that might end up in a log file or a Discord channel.

const SECRET_ENV_PATTERN = /(TOKEN|KEY|SECRET|PASSWORD|PASS|WEBHOOK)/i;

const SECRET_PATTERNS = [
  // Discord bot tokens: base64 id . timestamp . hmac
  /[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}/g,
  // Groq API keys
  /gsk_[A-Za-z0-9]{20,}/g,
  // Discord webhook URLs
  /https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/g,
  // Generic bearer headers
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
];

function secretValues(env = process.env) {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_PATTERN.test(name) && typeof value === 'string' && value.length >= 8)
    .map(([, value]) => value)
    // Replace longer secrets first so a secret containing another is fully removed.
    .sort((a, b) => b.length - a.length);
}

export function redact(input, env = process.env) {
  if (input === null || input === undefined) return input;
  let text = String(input);
  for (const value of secretValues(env)) {
    text = text.split(value).join('[REDACTED]');
  }
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, '[REDACTED]');
  }
  return text;
}

export function redactObject(value, env = process.env, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redact(value, env);
  if (typeof value !== 'object' || depth > 5) return value;
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, env), stack: redact(value.stack, env) };
  }
  if (Array.isArray(value)) return value.map((item) => redactObject(item, env, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_ENV_PATTERN.test(key) && typeof item === 'string' ? '[REDACTED]' : redactObject(item, env, depth + 1);
  }
  return out;
}
