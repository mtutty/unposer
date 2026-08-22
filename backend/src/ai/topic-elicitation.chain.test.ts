jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { runTopicTurn } from './topic-elicitation.chain';
import { getQuestion } from '../models/question-library';

const mockStructuredCall = structuredCall as jest.Mock;

describe('runTopicTurn', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
    mockStructuredCall.mockResolvedValue({ reply: 'Tell me more.', closeTopic: false, closedBy: 'model' });
  });

  it('embeds the question prompt, its primary/secondary dimensions, and the close-criteria block', async () => {
    const question = getQuestion('Q24')!; // detail_orientation P, agreeableness/conscientiousness s

    await runTopicTurn({
      question,
      channel: 'app',
      history: [
        { role: 'assistant', content: question.prompt },
        { role: 'user', content: 'I notice typos first.' }
      ]
    });

    const [, system] = mockStructuredCall.mock.calls[0];
    expect(system).toContain(question.prompt);
    expect(system).toContain('Primary dimension(s) for this question: detail_orientation.');
    expect(system).toContain('Secondary: agreeableness, conscientiousness.');
    expect(system).toContain('CLOSE THIS TOPIC WHEN ANY OF THE FOLLOWING HOLD');
    expect(system).toContain('always honor this immediately');
  });

  it('only includes an ADAPTIVE PROBES block for a question with probeRules (Q0)', async () => {
    const q0 = getQuestion('Q0')!;
    const q1 = getQuestion('Q1')!;

    await runTopicTurn({ question: q0, channel: 'app', history: [{ role: 'user', content: 'hi' }] });
    const [, systemForQ0] = mockStructuredCall.mock.calls[0];
    expect(systemForQ0).toContain('ADAPTIVE PROBES');
    expect(systemForQ0).toContain('Modesty, self-efficacy');

    await runTopicTurn({ question: q1, channel: 'app', history: [{ role: 'user', content: 'hi' }] });
    const [, systemForQ1] = mockStructuredCall.mock.calls[1];
    expect(systemForQ1).not.toContain('ADAPTIVE PROBES');
  });

  it('gives channel-specific guidance for app vs. email', async () => {
    const question = getQuestion('Q1')!;

    await runTopicTurn({ question, channel: 'app', history: [{ role: 'user', content: 'hi' }] });
    expect(mockStructuredCall.mock.calls[0][1]).toContain('This is live chat');

    await runTopicTurn({ question, channel: 'email', history: [{ role: 'user', content: 'hi' }] });
    expect(mockStructuredCall.mock.calls[1][1]).toContain('This is an email thread');
  });

  it('renders history with Candidate/You role labels and returns the structured result verbatim', async () => {
    mockStructuredCall.mockResolvedValueOnce({ reply: 'Got it, that\'s plenty.', closeTopic: true, closedBy: 'user' });
    const question = getQuestion('Q1')!;

    const result = await runTopicTurn({
      question,
      channel: 'app',
      history: [
        { role: 'assistant', content: question.prompt },
        { role: 'user', content: "That's all I've got on that." }
      ]
    });

    const [, , human] = mockStructuredCall.mock.calls[0];
    expect(human).toBe(`You: ${question.prompt}\nCandidate: That's all I've got on that.`);
    expect(result).toEqual({ reply: "Got it, that's plenty.", closeTopic: true, closedBy: 'user' });
  });
});
