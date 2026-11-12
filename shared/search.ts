export function readTagQuery(value: string): string[] {
  if (value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed) && parsed.every(t => typeof t === 'string')) return parsed;
    } catch { return []; }
  }
  return value.split(',').filter(Boolean);
}

export function writeTagQuery(tags: string[]) {
  return tags.length ? JSON.stringify(tags) : null;
}
