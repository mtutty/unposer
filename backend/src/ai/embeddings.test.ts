const mockConfig: any = { embeddings: { apiKey: 'test-embeddings-key' } };
jest.mock('../config', () => ({ config: mockConfig }));

const mockEmbedQuery = jest.fn();
const mockEmbedDocuments = jest.fn();
const MockOpenAIEmbeddings = jest.fn().mockImplementation((opts: any) => ({
  __opts: opts,
  embedQuery: mockEmbedQuery,
  embedDocuments: mockEmbedDocuments
}));
jest.mock('@langchain/openai', () => ({ OpenAIEmbeddings: MockOpenAIEmbeddings }));

import { embedText, embedTexts } from './embeddings';
import { AppError } from '../types';

describe('embeddings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.embeddings.apiKey = 'test-embeddings-key';
  });

  describe('embedText', () => {
    // getEmbeddingsClient()'s own AppError('EMBEDDINGS_NOT_CONFIGURED', ..., 503) is thrown
    // *inside* embedText's try block, so the catch below re-wraps it as EMBEDDINGS_ERROR/502 —
    // the specific code/status never reaches the caller. Asserting the current (masked) behavior
    // here, not the apparently-intended one; flagged separately rather than changed unasked.
    it('surfaces the missing-key error as EMBEDDINGS_ERROR/502, not the more specific EMBEDDINGS_NOT_CONFIGURED/503', async () => {
      mockConfig.embeddings.apiKey = '';

      await expect(embedText('hello')).rejects.toMatchObject({
        code: 'EMBEDDINGS_ERROR',
        status: 502
      });
      expect(MockOpenAIEmbeddings).not.toHaveBeenCalled();
    });

    it('embeds one string via embedQuery, using the fixed model/dimensions pinned to the vector column width', async () => {
      mockEmbedQuery.mockResolvedValue([0.1, 0.2, 0.3]);

      const result = await embedText('a candidate story');

      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(mockEmbedQuery).toHaveBeenCalledWith('a candidate story');
      expect(MockOpenAIEmbeddings).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-embeddings-key', model: 'text-embedding-3-small', dimensions: 1536 })
      );
    });

    it('wraps a provider failure in an AppError rather than letting it propagate raw', async () => {
      mockEmbedQuery.mockRejectedValue(new Error('rate limited'));

      await expect(embedText('hello')).rejects.toBeInstanceOf(AppError);
      await expect(embedText('hello')).rejects.toMatchObject({ code: 'EMBEDDINGS_ERROR', status: 502 });
    });
  });

  describe('embedTexts', () => {
    // Same masking as embedText above.
    it('surfaces the missing-key error as EMBEDDINGS_ERROR/502, not the more specific EMBEDDINGS_NOT_CONFIGURED/503', async () => {
      mockConfig.embeddings.apiKey = '';

      await expect(embedTexts(['a', 'b'])).rejects.toMatchObject({ code: 'EMBEDDINGS_ERROR', status: 502 });
    });

    it('embeds a batch of strings via embedDocuments', async () => {
      mockEmbedDocuments.mockResolvedValue([[0.1], [0.2]]);

      const result = await embedTexts(['story one', 'story two']);

      expect(result).toEqual([[0.1], [0.2]]);
      expect(mockEmbedDocuments).toHaveBeenCalledWith(['story one', 'story two']);
    });

    it('wraps a provider failure in an AppError', async () => {
      mockEmbedDocuments.mockRejectedValue(new Error('network error'));

      await expect(embedTexts(['a'])).rejects.toMatchObject({ code: 'EMBEDDINGS_ERROR', status: 502 });
    });
  });
});
