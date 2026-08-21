// Heuristic trim of quoted-reply boilerplate from an inbound plain-text email body — a
// best-effort cut, not a full quote-parser. Good enough for the common mail clients (Gmail,
// Outlook, Apple Mail): stop at the first line that looks like a "wrote:" attribution, an
// "-----Original Message-----" marker, or the first run of "> "-quoted lines, and trim trailing
// signature-block whitespace. Anything after the cut point is discarded.
const WROTE_LINE = /^\s*On .{0,120} wrote:\s*$/i;
const ORIGINAL_MESSAGE_MARKER = /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i;
const QUOTED_LINE = /^\s*>/;

export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cutIndex = lines.findIndex((line) => WROTE_LINE.test(line) || ORIGINAL_MESSAGE_MARKER.test(line) || QUOTED_LINE.test(line));

  const kept = cutIndex === -1 ? lines : lines.slice(0, cutIndex);
  return kept.join('\n').trim();
}
