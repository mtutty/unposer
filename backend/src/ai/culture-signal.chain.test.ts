jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { inferCultureSignals } from './culture-signal.chain';

const mockStructuredCall = structuredCall as jest.Mock;

describe('inferCultureSignals', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
  });

  it('returns an empty array without calling the model when there are no sources', async () => {
    const result = await inferCultureSignals([]);

    expect(result).toEqual([]);
    expect(mockStructuredCall).not.toHaveBeenCalled();
  });

  it('includes every source exchange in the prompt, labeled with its question id', async () => {
    mockStructuredCall.mockResolvedValueOnce({ signals: [] });

    await inferCultureSignals([
      { exchangeId: 'ex-1', questionId: 'Q0', text: 'The stars were the ones who shipped fast.' },
      { exchangeId: 'ex-2', questionId: 'Q15', text: 'I could not work somewhere that punished honest mistakes.' }
    ]);

    const [, , human] = mockStructuredCall.mock.calls[0];
    expect(human).toContain('[ex-1] (Q0) "The stars were the ones who shipped fast."');
    expect(human).toContain('[ex-2] (Q15) "I could not work somewhere that punished honest mistakes."');
  });

  it('drops a signal citing an unknown exchange id', async () => {
    mockStructuredCall.mockResolvedValueOnce({
      signals: [{ quadrant: 'market', reasoning: 'r', sourceExchangeIds: ['ex-does-not-exist'] }]
    });

    const result = await inferCultureSignals([{ exchangeId: 'ex-1', questionId: 'Q0', text: 't' }]);

    expect(result).toEqual([]);
  });

  it('de-dupes repeated quadrants, keeping the first', async () => {
    mockStructuredCall.mockResolvedValueOnce({
      signals: [
        { quadrant: 'clan', reasoning: 'first', sourceExchangeIds: ['ex-1'] },
        { quadrant: 'clan', reasoning: 'second', sourceExchangeIds: ['ex-1'] }
      ]
    });

    const result = await inferCultureSignals([{ exchangeId: 'ex-1', questionId: 'Q0', text: 't' }]);

    expect(result).toEqual([{ quadrant: 'clan', reasoning: 'first', sourceExchangeIds: ['ex-1'] }]);
  });

  it('passes through multiple distinct quadrants', async () => {
    mockStructuredCall.mockResolvedValueOnce({
      signals: [
        { quadrant: 'hierarchy', reasoning: 'process mastery rewarded', sourceExchangeIds: ['ex-1'] },
        { quadrant: 'market', reasoning: 'numbers rewarded', sourceExchangeIds: ['ex-2'] }
      ]
    });

    const result = await inferCultureSignals([
      { exchangeId: 'ex-1', questionId: 'Q0', text: 't1' },
      { exchangeId: 'ex-2', questionId: 'Q21', text: 't2' }
    ]);

    expect(result.map((s) => s.quadrant).sort()).toEqual(['hierarchy', 'market']);
  });
});
