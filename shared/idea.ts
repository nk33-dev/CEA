export function ideaParts(text: string) {
  const normalized = text.replace(/\r\n/g, '\n');
  const split = normalized.indexOf('\n\n');
  return split < 0
    ? { reference: normalized, details: '' }
    : { reference: normalized.slice(0, split), details: normalized.slice(split + 2) };
}

export function composeIdea(reference: string, details: string) {
  return details ? `${reference}\n\n${details}` : reference;
}
