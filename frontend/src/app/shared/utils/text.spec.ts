import { truncateWords } from './text';

describe('truncateWords', () => {
  it('returns null for null, undefined, and empty string', () => {
    expect(truncateWords(null)).toBeNull();
    expect(truncateWords(undefined)).toBeNull();
    expect(truncateWords('')).toBeNull();
  });

  it('returns short strings unchanged', () => {
    expect(truncateWords('remote, west coast preferred')).toBe('remote, west coast preferred');
  });

  it('truncates strings longer than the word limit and appends an ellipsis', () => {
    const words = Array.from({ length: 25 }, (_, i) => `word${i}`).join(' ');

    const result = truncateWords(words, 20);

    expect(result).toBe(Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ') + '…');
  });

  it('respects a custom limit', () => {
    expect(truncateWords('one two three four', 2)).toBe('one two…');
  });

  it('trims surrounding whitespace before counting words', () => {
    expect(truncateWords('  padded value  ')).toBe('padded value');
  });

  it('stringifies non-string values (e.g. extracted JSON fields)', () => {
    expect(truncateWords({ city: 'Austin', remote: true })).toBe('{"city":"Austin","remote":true}');
  });
});
