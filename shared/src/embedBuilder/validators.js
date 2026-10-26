export const EMBED_LIMITS = Object.freeze({
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  total: 6000,
});

export const MESSAGE_LIMITS = Object.freeze({
  content: 2000,
  embeds: 10,
  actionRows: 5,
  buttonsPerRow: 5,
  selectOptions: 25,
  customId: 100,
});

export function isHexColour(value) {
  return typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim());
}

/** "#5865F2" or "5865F2" to an integer, else null. */
export function parseColour(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
  if (!isHexColour(value)) return null;
  return Number.parseInt(value.trim().replace('#', ''), 16);
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Total character count as Discord measures it against the 6000 limit. */
export function embedLength(spec) {
  return [
    spec.title,
    spec.description,
    spec.author?.name,
    spec.footer?.text,
    ...(spec.fields ?? []).flatMap((f) => [f.name, f.value]),
  ].reduce((sum, part) => sum + (part ? String(part).length : 0), 0);
}

/**
 * Validates a plain embed description object. Returns a list of human-readable problems.
 */
export function validateEmbed(spec) {
  const errors = [];
  const tooLong = (label, value, max) => {
    if (value && String(value).length > max) errors.push(`${label} must be ${max} characters or fewer.`);
  };

  tooLong('Title', spec.title, EMBED_LIMITS.title);
  tooLong('Description', spec.description, EMBED_LIMITS.description);
  tooLong('Author name', spec.author?.name, EMBED_LIMITS.author);
  tooLong('Footer', spec.footer?.text, EMBED_LIMITS.footer);

  const fields = spec.fields ?? [];
  if (fields.length > EMBED_LIMITS.fields) errors.push(`An embed can have at most ${EMBED_LIMITS.fields} fields.`);
  fields.forEach((field, i) => {
    if (!field.name || !field.value) errors.push(`Field ${i + 1} needs both a name and a value.`);
    tooLong(`Field ${i + 1} name`, field.name, EMBED_LIMITS.fieldName);
    tooLong(`Field ${i + 1} value`, field.value, EMBED_LIMITS.fieldValue);
  });

  if (spec.color !== undefined && spec.color !== null && parseColour(spec.color) === null) {
    errors.push('Colour must be a hex value such as #5865F2.');
  }
  for (const [label, url] of [
    ['URL', spec.url],
    ['Author URL', spec.author?.url],
    ['Author icon', spec.author?.iconURL],
    ['Footer icon', spec.footer?.iconURL],
    ['Thumbnail', spec.thumbnail],
    ['Image', spec.image],
  ]) {
    if (url && !isHttpUrl(url)) errors.push(`${label} must be a valid http(s) link.`);
  }

  const hasContent = spec.title || spec.description || fields.length || spec.image || spec.thumbnail || spec.author?.name;
  if (!hasContent) errors.push('An embed needs at least a title, description, field or image.');
  if (embedLength(spec) > EMBED_LIMITS.total) errors.push(`The embed exceeds Discord's ${EMBED_LIMITS.total} character limit.`);
  return errors;
}
