/**
 * Truncates arbitrary extracted-field values (see logistics_responses.data /
 * Message.metadata) down to a short, tooltip/log-friendly phrase. Shared by the area tracker's
 * tooltip summary and the chat panel's extraction-log entries so both read the same value the
 * same way.
 */
export function truncateWords(value: unknown, limit = 20): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).trim();
  if (!text) return null;

  const words = text.split(/\s+/);
  if (words.length <= limit) return text;
  return `${words.slice(0, limit).join(' ')}…`;
}
