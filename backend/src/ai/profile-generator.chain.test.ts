jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { generateCandidateProfile, ProfileGenerationInput } from './profile-generator.chain';

const mockStructuredCall = structuredCall as jest.Mock;

function baseInput(overrides: Partial<ProfileGenerationInput> = {}): ProfileGenerationInput {
  return {
    resume: null,
    isCareerChanger: false,
    logistics: {} as any,
    deepPromptTranscript: [],
    ...overrides
  };
}

function stubResult(overrides: Record<string, any> = {}) {
  return {
    headline: 'Product-minded engineer',
    summary: 'Summary text',
    workHistory: [],
    insights: [{ id: 'i1', category: 'strength', statement: 'Statement', evidence: 'Evidence' }],
    workStyle: { preferredEnvironment: 'remote', teamDynamics: '', communicationStyle: '' },
    goals: { shortTerm: '', longTerm: '', idealNextRole: '' },
    preferences: { remote: '', companySize: '', industry: [] },
    starStories: [],
    ...overrides
  };
}

describe('generateCandidateProfile', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
  });

  it('sends resume/logistics/transcript in the human prompt and passes temperature 0.4', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(
      baseInput({
        resume: { summary: 'Backend engineer' } as any,
        logistics: { targetRole: 'staff engineer' } as any,
        deepPromptTranscript: [{ role: 'user', content: 'I led a rewrite once.', heavy: false }]
      })
    );

    const [, , human, temperature] = mockStructuredCall.mock.calls[0];
    expect(human).toContain('Backend engineer');
    expect(human).toContain('staff engineer');
    expect(human).toContain('Candidate: I led a rewrite once.');
    expect(temperature).toBe(0.4);
  });

  it('does not mention career-changer framing when isCareerChanger is false', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(baseInput({ isCareerChanger: false }));

    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).not.toMatch(/changing industries\/roles/);
  });

  it('adds career-changer framing to the system prompt when isCareerChanger is true', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(baseInput({ isCareerChanger: true }));

    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/changing industries\/roles/);
  });

  it('omits the corrections block from both prompts when none are given', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(baseInput());

    const [, system, human] = mockStructuredCall.mock.calls[0];
    expect(system).not.toMatch(/authoritative ground truth/);
    expect(human).not.toContain('Candidate corrections');
  });

  it('treats provided corrections as authoritative in both prompts', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(
      baseInput({
        corrections: [{ question: 'Are you a leader?', wrongAnswer: 'Reluctant leader', correction: 'Actually seeks it out' }]
      })
    );

    const [, system, human] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/authoritative ground truth/);
    expect(human).toContain('Are you a leader?');
    expect(human).toContain('Actually seeks it out');
  });

  it('tells the model not to restate already-generated personality insights, and lists them for context', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(
      baseInput({ personalityInsights: [{ type: 'own_words', text: 'Values autonomy highly' }] })
    );

    const [, system, human] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/do not restate or re-derive/);
    expect(human).toContain('Values autonomy highly');
  });

  it('stamps every returned insight as status "active" and adds an empty openQuestions list', async () => {
    mockStructuredCall.mockResolvedValue(
      stubResult({
        insights: [
          { id: 'i1', category: 'strength', statement: 'A', evidence: 'ev' },
          { id: 'i2', category: 'growth_area', statement: 'B', evidence: 'ev' }
        ]
      })
    );

    const result = await generateCandidateProfile(baseInput());

    expect(result.insights).toEqual([
      { id: 'i1', category: 'strength', statement: 'A', evidence: 'ev', status: 'active' },
      { id: 'i2', category: 'growth_area', statement: 'B', evidence: 'ev', status: 'active' }
    ]);
    expect(result.openQuestions).toEqual([]);
  });

  it('marks a heavy transcript turn RESTRICTED and instructs the model never to quote it verbatim', async () => {
    mockStructuredCall.mockResolvedValue(stubResult());

    await generateCandidateProfile(
      baseInput({
        deepPromptTranscript: [
          { role: 'assistant', content: 'What happened when it all fell apart?', heavy: true },
          { role: 'user', content: 'I froze for a moment, then called my manager.', heavy: true },
          { role: 'user', content: 'I enjoy pairing on hard problems.', heavy: false }
        ]
      })
    );

    const [, system, human] = mockStructuredCall.mock.calls[0];
    expect(system).toMatch(/never quote a \[RESTRICTED\] turn's text directly or near-verbatim/);
    expect(human).toContain('Interviewer [RESTRICTED]: What happened when it all fell apart?');
    expect(human).toContain('Candidate [RESTRICTED]: I froze for a moment, then called my manager.');
    expect(human).toContain('Candidate: I enjoy pairing on hard problems.');
  });

  it('redacts an insight\'s evidence field to its own statement when it verbatim-quotes a heavy answer, but leaves a non-heavy quote alone', async () => {
    const heavyAnswer = 'I completely broke down and could not speak for several minutes in the meeting.';
    mockStructuredCall.mockResolvedValue(
      stubResult({
        insights: [
          { id: 'i1', category: 'stress_response', statement: 'Struggles under acute pressure.', evidence: heavyAnswer },
          { id: 'i2', category: 'collaboration', statement: 'Seeks out pairing.', evidence: 'Mentioned enjoying pairing on hard problems regularly.' }
        ]
      })
    );

    const result = await generateCandidateProfile(
      baseInput({
        deepPromptTranscript: [
          { role: 'user', content: heavyAnswer, heavy: true },
          { role: 'user', content: 'Mentioned enjoying pairing on hard problems regularly.', heavy: false }
        ]
      })
    );

    expect(result.insights[0].evidence).toBe('Struggles under acute pressure.');
    expect(result.insights[1].evidence).toBe('Mentioned enjoying pairing on hard problems regularly.');
  });

  it('does not redact a short evidence string even if it happens to be a substring of a heavy answer', async () => {
    mockStructuredCall.mockResolvedValue(
      stubResult({
        insights: [{ id: 'i1', category: 'strength', statement: 'Calm under pressure.', evidence: 'stayed calm' }]
      })
    );

    const result = await generateCandidateProfile(
      baseInput({
        deepPromptTranscript: [{ role: 'user', content: 'I stayed calm even though everyone else panicked.', heavy: true }]
      })
    );

    expect(result.insights[0].evidence).toBe('stayed calm');
  });
});
