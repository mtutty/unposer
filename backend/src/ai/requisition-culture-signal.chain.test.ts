jest.mock('./llm', () => ({ structuredCall: jest.fn() }));
import { structuredCall } from './llm';
import { inferRequisitionCultureSignals } from './requisition-culture-signal.chain';

const mockStructuredCall = structuredCall as jest.Mock;

describe('inferRequisitionCultureSignals', () => {
  beforeEach(() => {
    mockStructuredCall.mockReset();
  });

  it('returns an empty array without calling the model when there are no sources', async () => {
    const result = await inferRequisitionCultureSignals([]);

    expect(result).toEqual([]);
    expect(mockStructuredCall).not.toHaveBeenCalled();
  });

  it('includes every source message in the prompt, labeled with its message id', async () => {
    mockStructuredCall.mockResolvedValueOnce({ signals: [] });

    await inferRequisitionCultureSignals([
      { messageId: 'msg-1', text: 'We reward whoever ships fastest.' },
      { messageId: 'msg-2', text: 'Nobody who needed heavy process lasted here.' }
    ]);

    const [, , human] = mockStructuredCall.mock.calls[0];
    expect(human).toContain('[msg-1] "We reward whoever ships fastest."');
    expect(human).toContain('[msg-2] "Nobody who needed heavy process lasted here."');
  });

  it('drops a signal citing an unknown message id', async () => {
    mockStructuredCall.mockResolvedValueOnce({
      signals: [{ quadrant: 'market', reasoning: 'r', sourceMessageIds: ['msg-does-not-exist'] }]
    });

    const result = await inferRequisitionCultureSignals([{ messageId: 'msg-1', text: 't' }]);

    expect(result).toEqual([]);
  });

  it('de-dupes repeated quadrants, keeping the first', async () => {
    mockStructuredCall.mockResolvedValueOnce({
      signals: [
        { quadrant: 'clan', reasoning: 'first', sourceMessageIds: ['msg-1'] },
        { quadrant: 'clan', reasoning: 'second', sourceMessageIds: ['msg-1'] }
      ]
    });

    const result = await inferRequisitionCultureSignals([{ messageId: 'msg-1', text: 't' }]);

    expect(result).toEqual([{ quadrant: 'clan', reasoning: 'first', sourceMessageIds: ['msg-1'] }]);
  });

  it('passes through multiple distinct quadrants', async () => {
    mockStructuredCall.mockResolvedValueOnce({
      signals: [
        { quadrant: 'hierarchy', reasoning: 'process mastery rewarded', sourceMessageIds: ['msg-1'] },
        { quadrant: 'market', reasoning: 'numbers rewarded', sourceMessageIds: ['msg-2'] }
      ]
    });

    const result = await inferRequisitionCultureSignals([
      { messageId: 'msg-1', text: 't1' },
      { messageId: 'msg-2', text: 't2' }
    ]);

    expect(result.map((s) => s.quadrant).sort()).toEqual(['hierarchy', 'market']);
  });
});
