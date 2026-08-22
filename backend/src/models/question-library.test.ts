import { getQuestion, questionLibrary } from './question-library';
import { DimensionKey } from '../types';

const ALL_DIMENSIONS: DimensionKey[] = [
  'emotional_stability',
  'social_energy',
  'dominance',
  'agreeableness',
  'conscientiousness',
  'openness',
  'change_orientation',
  'thinking_style',
  'detail_orientation',
  'motivation',
  'work_style'
];

// spec §3/§8/Appendix A — Q5, Q6, Q19, Q20 are the emotionally demanding, never-recruiter-facing set.
const EXPECTED_HEAVY = ['Q5', 'Q6', 'Q19', 'Q20'];

describe('questionLibrary data integrity', () => {
  it('has all 26 questions (Q0 seed + Q1-Q22 existing + Q23-Q25 gap-closers), no duplicates', () => {
    expect(questionLibrary).toHaveLength(26);
    const ids = questionLibrary.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every question real, non-empty prompt text', () => {
    // The plan doc's Iteration 2 notes record when this was still a gap (Q0-Q22 had `prompt:
    // null`) — Appendix A closed it. This guards against that regressing silently.
    for (const q of questionLibrary) {
      expect(q.prompt.length).toBeGreaterThan(0);
    }
  });

  it('only Q0 has an altPrompt', () => {
    for (const q of questionLibrary) {
      if (q.id === 'Q0') {
        expect(q.altPrompt).toBeTruthy();
      } else {
        expect(q.altPrompt).toBeUndefined();
      }
    }
  });

  it('flags exactly Q5, Q6, Q19, Q20 as heavy', () => {
    const heavyIds = questionLibrary.filter((q) => q.heavy).map((q) => q.id);
    expect(heavyIds.sort()).toEqual([...EXPECTED_HEAVY].sort());
  });

  it('every dimensionLoads key is one of the 11 spec dimensions', () => {
    for (const q of questionLibrary) {
      const keys = Object.keys(q.dimensionLoads) as DimensionKey[];
      expect(keys.length).toBeGreaterThan(0);
      keys.forEach((k) => expect(ALL_DIMENSIONS).toContain(k));
    }
  });

  it('gives all but one question at least one primary dimension', () => {
    // Q17 ("The Skill That Won't Stick") is secondary-only in the spec's own §3 coverage matrix
    // (ES/CO/OP/MO all 's', no 'P') — verified against the table, not a transcription slip. Flagged
    // to the spec's author rather than "corrected" here; see the plan doc's Iteration 2 notes.
    const noPrimary = questionLibrary.filter((q) => !Object.values(q.dimensionLoads).includes('P'));
    expect(noPrimary.map((q) => q.id)).toEqual(['Q17']);
  });

  it('gives every question a theme', () => {
    for (const q of questionLibrary) {
      expect(q.theme.length).toBeGreaterThan(0);
    }
  });
});

describe('getQuestion', () => {
  it('returns the question with the matching id', () => {
    expect(getQuestion('Q23')?.shortName).toBe('The Gut Call');
  });

  it('returns undefined for an unknown id', () => {
    expect(getQuestion('Q99')).toBeUndefined();
  });
});
