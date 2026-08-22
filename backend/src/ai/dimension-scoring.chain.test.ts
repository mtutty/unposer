import { DimensionKey } from '../types';

jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { DIMENSION_CONFIGS, scoreDimension } from './dimension-scoring.chain';

const mockStructuredCall = structuredCall as jest.Mock;

// The 11 dimensions from spec §2 — same list DIMENSION_CONFIGS must cover exactly.
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

describe('DIMENSION_CONFIGS', () => {
  it('has exactly one config per spec dimension, no more, no fewer', () => {
    expect(Object.keys(DIMENSION_CONFIGS).sort()).toEqual([...ALL_DIMENSIONS].sort());
  });

  it.each(ALL_DIMENSIONS)('%s config has a name, both poles, and a non-empty facet list', (dimension) => {
    const cfg = DIMENSION_CONFIGS[dimension];
    expect(cfg.key).toBe(dimension);
    expect(cfg.name.length).toBeGreaterThan(0);
    expect(cfg.leftPole.length).toBeGreaterThan(0);
    expect(cfg.rightPole.length).toBeGreaterThan(0);
    expect(cfg.facets.length).toBeGreaterThan(0);
  });
});

describe('scoreDimension', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
    mockStructuredCall.mockResolvedValue({
      evidence: [],
      provisional_score: null,
      confidence: 'insufficient_signal',
      reasoning: 'no signal'
    });
  });

  it.each(ALL_DIMENSIONS)(
    'instantiates the §4.3 template for %s — dimension, poles, facets, and the confounds check all present',
    async (dimension) => {
      await scoreDimension({ dimension, questionText: 'What matters to you at work?', answerText: 'It depends.' });

      expect(mockStructuredCall).toHaveBeenCalledTimes(1);
      const [, system, human] = mockStructuredCall.mock.calls[0];
      const cfg = DIMENSION_CONFIGS[dimension];

      expect(system).toContain(cfg.name);
      expect(system).toContain(cfg.leftPole);
      expect(system).toContain(cfg.rightPole);
      cfg.facets.forEach((facet: string) => expect(system).toContain(facet));

      // STEP 3 of §4.3 — must be present in every instantiated prompt, not just an ES reference.
      expect(system).toContain('Check for confounds');
      expect(system).toContain('self-deprecation');
      expect(system).toContain('former employer');

      expect(human).toContain('What matters to you at work?');
      expect(human).toContain('It depends.');
    }
  );

  it('maps a fired rubric through to an evidence object matching the §4.1 shape', async () => {
    mockStructuredCall.mockResolvedValue({
      evidence: [
        {
          span: 'I love working alone',
          direction: 'low',
          strength: 'strong',
          type: 'explicit_statement',
          facet: 'independence',
          note: 'Direct, unhedged statement of preference for solo work'
        }
      ],
      provisional_score: 15,
      confidence: 'medium-high',
      reasoning: 'Strong explicit preference for solo work, no countervailing evidence'
    });

    const result = await scoreDimension({
      dimension: 'work_style',
      questionText: 'How do you like to work?',
      answerText: 'I love working alone, always have — always will.'
    });

    expect(result.dimension).toBe('work_style');
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      span: 'I love working alone',
      direction: 'low',
      strength: 'strong',
      type: 'explicit_statement',
      facet: 'independence'
    });
    expect(result.provisionalScore).toBe(15);
    expect(result.confidence).toBe('medium-high');
  });

  it('passes through a null score on insufficient_signal rather than guessing', async () => {
    mockStructuredCall.mockResolvedValue({
      evidence: [],
      provisional_score: null,
      confidence: 'insufficient_signal',
      reasoning: 'Nothing in this answer bears on the dimension'
    });

    const result = await scoreDimension({
      dimension: 'thinking_style',
      questionText: 'What did you have for lunch?',
      answerText: 'A sandwich.'
    });

    expect(result.provisionalScore).toBeNull();
    expect(result.confidence).toBe('insufficient_signal');
    expect(result.evidence).toHaveLength(0);
  });
});
