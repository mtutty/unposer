import { computeOccasionId } from './occasion';

describe('computeOccasionId', () => {
  it('returns the UTC calendar date as YYYY-MM-DD', () => {
    expect(computeOccasionId(new Date('2026-08-21T14:32:00Z'))).toBe('2026-08-21');
  });

  it('treats two timestamps on the same UTC day as the same occasion', () => {
    const morning = computeOccasionId(new Date('2026-08-21T02:00:00Z'));
    const night = computeOccasionId(new Date('2026-08-21T23:59:00Z'));
    expect(morning).toBe(night);
  });

  it('treats timestamps that cross the UTC day boundary as distinct occasions', () => {
    const day1 = computeOccasionId(new Date('2026-08-21T23:59:00Z'));
    const day2 = computeOccasionId(new Date('2026-08-22T00:01:00Z'));
    expect(day1).not.toBe(day2);
  });
});
