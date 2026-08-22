jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { generateInsights } from './insight-generator.chain';

const mockStructuredCall = structuredCall as jest.Mock;

describe('generateInsights', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
  });

  it('returns an empty array without calling the model when there are no eligible dimensions', async () => {
    const result = await generateInsights({ dimensions: [] });

    expect(result).toEqual([]);
    expect(mockStructuredCall).not.toHaveBeenCalled();
  });

  it('only lists a tension candidate pair when both dimensions are eligible', async () => {
    mockStructuredCall.mockResolvedValue({ insights: [] });

    await generateInsights({
      dimensions: [
        { dimension: 'motivation', score: 80, band: 'medium', contextDependenceEligible: false, evidence: [{ id: 'ev1', span: 's', direction: 'high', note: 'n' }] }
        // dominance not included — its tension pairing with motivation should not appear.
      ]
    });

    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).not.toContain('High Motivation + low Dominance');

    mockStructuredCall.mockClear();
    mockStructuredCall.mockResolvedValue({ insights: [] });

    await generateInsights({
      dimensions: [
        { dimension: 'motivation', score: 80, band: 'medium', contextDependenceEligible: false, evidence: [{ id: 'ev1', span: 's', direction: 'high', note: 'n' }] },
        { dimension: 'dominance', score: 20, band: 'medium', contextDependenceEligible: false, evidence: [{ id: 'ev2', span: 's2', direction: 'low', note: 'n2' }] }
      ]
    });

    const [, systemWithBoth] = mockStructuredCall.mock.calls[0];
    expect(systemWithBoth).toContain('High Motivation + low Dominance');
  });

  it('marks only context-dependence-eligible dimensions as "VARIES BY TOPIC"', async () => {
    mockStructuredCall.mockResolvedValue({ insights: [] });

    await generateInsights({
      dimensions: [
        { dimension: 'dominance', score: 60, band: 'medium', contextDependenceEligible: true, evidence: [{ id: 'ev1', span: 's', direction: 'high', note: 'n' }] },
        { dimension: 'openness', score: 40, band: 'medium', contextDependenceEligible: false, evidence: [{ id: 'ev2', span: 's2', direction: 'low', note: 'n2' }] }
      ]
    });

    const [, , human] = mockStructuredCall.mock.calls[0];
    expect(human).toContain('dominance (Dominance / Assertiveness / Ambition): score 60/100');
    const dominanceLine = human.split('\n').find((l: string) => l.includes('dominance (Dominance'));
    expect(dominanceLine).toContain('VARIES BY TOPIC');
    const opennessLine = human.split('\n').find((l: string) => l.startsWith('openness ('));
    expect(opennessLine).not.toContain('VARIES BY TOPIC');
  });

  it('drops any insight citing an id or dimension not in the provided input, and caps at 7', async () => {
    const dims = [
      { dimension: 'openness' as const, score: 80, band: 'high', contextDependenceEligible: false, evidence: [{ id: 'ev1', span: 's', direction: 'high' as const, note: 'n' }] }
    ];
    mockStructuredCall.mockResolvedValueOnce({
      insights: [
        { type: 'own_words', text: 'legit', supportingDimensions: ['openness'], supportingEvidenceIds: ['ev1'] },
        { type: 'pattern', text: 'hallucinated evidence id', supportingDimensions: ['openness'], supportingEvidenceIds: ['ev-does-not-exist'] },
        ...Array.from({ length: 8 }, (_, i) => ({
          type: 'own_words',
          text: `extra ${i}`,
          supportingDimensions: ['openness'],
          supportingEvidenceIds: ['ev1']
        }))
      ]
    });

    const result = await generateInsights({ dimensions: dims });

    expect(result.every((i) => i.supportingEvidenceIds.every((id) => id === 'ev1'))).toBe(true);
    expect(result.find((i) => i.text === 'hallucinated evidence id')).toBeUndefined();
    expect(result.length).toBeLessThanOrEqual(7);
  });
});
