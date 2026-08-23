jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { generateReaskQuestion } from './reask.chain';

const mockStructuredCall = structuredCall as jest.Mock;

describe('generateReaskQuestion', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
  });

  it('passes the flagged insight and its evidence into the prompt, and returns the model\'s question', async () => {
    mockStructuredCall.mockResolvedValue({ question: 'Tell me about a time you had to lead under pressure.' });

    const result = await generateReaskQuestion(
      'Prefers working independently',
      'Described finishing a project solo over a weekend'
    );

    expect(result).toBe('Tell me about a time you had to lead under pressure.');
    const [schema, system, human, temperature] = mockStructuredCall.mock.calls[0];
    expect(schema).toBeDefined();
    expect(system).toMatch(/not accurate/i);
    expect(system).toMatch(/never.*rate/i);
    expect(human).toContain('Prefers working independently');
    expect(human).toContain('Described finishing a project solo over a weekend');
    expect(temperature).toBe(0.5);
  });
});
