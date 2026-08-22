jest.mock('../db/connection', () => ({ db: jest.fn() }));
jest.mock('../ai/embeddings', () => ({ embedText: jest.fn(), embedTexts: jest.fn() }));
jest.mock('../services/evidence.service');
import { EvidenceService } from '../services/evidence.service';
import { buildEvidenceSearchTool } from './evidence-search.tool';

describe('buildEvidenceSearchTool', () => {
  const mockSearch = EvidenceService.prototype.search as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the closed-over audience through to EvidenceService.search on every invocation', async () => {
    mockSearch.mockResolvedValue([]);
    const recruiterTool = buildEvidenceSearchTool('user-1', 'recruiter');

    await recruiterTool.invoke({ query: 'how do they handle pressure' } as any);

    expect(mockSearch).toHaveBeenCalledWith('user-1', 'how do they handle pressure', 5, 'recruiter');
  });

  it('passes "candidate" audience through unchanged for the candidate\'s own sandbox', async () => {
    mockSearch.mockResolvedValue([]);
    const candidateTool = buildEvidenceSearchTool('user-1', 'candidate');

    await candidateTool.invoke({ query: 'q', k: 3 } as any);

    expect(mockSearch).toHaveBeenCalledWith('user-1', 'q', 3, 'candidate');
  });

  it('formats hits with their tier and similarity', async () => {
    mockSearch.mockResolvedValueOnce([{ id: 'h1', tier: 'profile', content: 'some evidence', similarity: 0.812, metadata: {} }]);
    const t = buildEvidenceSearchTool('user-1', 'candidate');

    const result = await t.invoke({ query: 'q' } as any);

    expect(result).toContain('[profile]');
    expect(result).toContain('0.81');
    expect(result).toContain('some evidence');
  });
});
