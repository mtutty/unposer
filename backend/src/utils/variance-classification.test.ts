import { classifyVariance, VarianceEvidencePoint } from './variance-classification';

// Each scenario below is hand-computed (population std dev, Pearson r) in the plan doc's
// Iteration 4 notes — these aren't just "plausible-looking" fixtures, the numbers were chosen so
// exactly one branch of the classifier fires and the others provably don't.

function point(overrides: Partial<VarianceEvidencePoint>): VarianceEvidencePoint {
  return {
    evidenceId: 'ev',
    questionId: 'Q1',
    occasionId: '2026-01-01',
    sentAt: new Date('2026-01-01'),
    evidenceScore: 50,
    ...overrides
  };
}

describe('classifyVariance', () => {
  it('returns null when there is not enough evidence to say anything (fewer than 3 points)', () => {
    expect(classifyVariance([point({}), point({})])).toBeNull();
  });

  it('returns null when the spread is low (stable dimension)', () => {
    const points = [
      point({ evidenceScore: 70, sentAt: new Date('2026-01-01'), occasionId: '2026-01-01' }),
      point({ evidenceScore: 72, sentAt: new Date('2026-01-02'), occasionId: '2026-01-02' }),
      point({ evidenceScore: 68, sentAt: new Date('2026-01-03'), occasionId: '2026-01-03' })
    ];
    expect(classifyVariance(points)).toBeNull();
  });

  it('classifies a chronological trend as monotonic_drift, even when it aligns with topic changes', () => {
    // Q_A always precedes Q_B in time — a pure topic-grouping test can't tell this apart from a
    // topic effect, which is exactly why drift is checked first (see the file's own comment).
    const points = [
      point({ questionId: 'QA', occasionId: 'o1', sentAt: new Date('2026-01-01'), evidenceScore: 90 }),
      point({ questionId: 'QB', occasionId: 'o2', sentAt: new Date('2026-01-08'), evidenceScore: 20 })
    ];
    // (only 2 points — pad to 3 to clear the minimum)
    points.push(point({ questionId: 'QB', occasionId: 'o3', sentAt: new Date('2026-01-15'), evidenceScore: 22 }));

    const result = classifyVariance(points)!;
    expect(result.flagType).toBe('monotonic_drift');
  });

  it('classifies interleaved-but-consistent topics as topic_linked (genuine context-dependence)', () => {
    // Q_A and Q_B alternate in time (no trend), each is internally consistent, and the two
    // topics disagree with each other by a wide, stable margin.
    const points = [
      point({ questionId: 'QA', occasionId: 'o1', sentAt: new Date('2026-01-01'), evidenceScore: 90 }),
      point({ questionId: 'QB', occasionId: 'o2', sentAt: new Date('2026-01-02'), evidenceScore: 20 }),
      point({ questionId: 'QA', occasionId: 'o3', sentAt: new Date('2026-01-03'), evidenceScore: 88 }),
      point({ questionId: 'QB', occasionId: 'o4', sentAt: new Date('2026-01-04'), evidenceScore: 18 }),
      point({ questionId: 'QA', occasionId: 'o5', sentAt: new Date('2026-01-05'), evidenceScore: 92 }),
      point({ questionId: 'QB', occasionId: 'o6', sentAt: new Date('2026-01-06'), evidenceScore: 22 })
    ];

    const result = classifyVariance(points)!;
    expect(result.flagType).toBe('topic_linked');
    expect(result.topicSpread.sort()).toEqual(['QA', 'QB']);
  });

  it('classifies a single question that bounces non-monotonically across occasions as occasion_linked', () => {
    const points = [
      point({ questionId: 'Q1', occasionId: 'o1', sentAt: new Date('2026-01-01'), evidenceScore: 85 }),
      point({ questionId: 'Q1', occasionId: 'o2', sentAt: new Date('2026-01-08'), evidenceScore: 20 }),
      point({ questionId: 'Q1', occasionId: 'o3', sentAt: new Date('2026-01-15'), evidenceScore: 80 })
    ];

    const result = classifyVariance(points)!;
    expect(result.flagType).toBe('occasion_linked');
    expect(result.occasionSpread).toEqual(['o1', 'o2', 'o3']);
  });

  it('falls back to ambiguous when the spread fits none of the three named patterns', () => {
    // A single-sample topic, a two-sample topic that disagrees wildly with itself, and another
    // single-sample topic — no clean trend, no topic-level consistency, no clean occasion-repeat
    // agreement (between-topic spread stays high even after averaging the noisy topic).
    const points = [
      point({ questionId: 'QA', occasionId: 'o1', sentAt: new Date('2026-01-01'), evidenceScore: 90 }),
      point({ questionId: 'QB', occasionId: 'o2', sentAt: new Date('2026-01-02'), evidenceScore: 5 }),
      point({ questionId: 'QB', occasionId: 'o3', sentAt: new Date('2026-01-03'), evidenceScore: 95 }),
      point({ questionId: 'QC', occasionId: 'o4', sentAt: new Date('2026-01-04'), evidenceScore: 20 })
    ];

    const result = classifyVariance(points)!;
    expect(result.flagType).toBe('ambiguous');
    expect(result.contributingEvidenceIds).toHaveLength(4);
  });
});
