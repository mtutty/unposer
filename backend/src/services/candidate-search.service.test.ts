jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';
import { CandidateSearchService } from './candidate-search.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.andWhereILike = jest.fn(() => builder);
  builder.andWhere = jest.fn(() => builder);
  builder.orderBy = jest.fn(() => builder);
  builder.limit = jest.fn(() => builder);
  builder.offset = jest.fn(() => builder);
  builder.count = jest.fn(() => builder);
  builder.first = jest.fn();
  // orderBy/limit/offset resolve the query — make the builder itself thenable/awaitable so
  // `await scoped().orderBy(...).limit(...).offset(...)` resolves to whatever rows() returns.
  builder.then = (resolve: any) => resolve(builder.rows ?? []);
  return builder;
}

describe('CandidateSearchService.search — employer onboarding Phase 3 (spec §5)', () => {
  let service: CandidateSearchService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CandidateSearchService();
    builder = makeBuilder();
    builder.first.mockResolvedValue({ n: '0' });
    mockDb.mockReturnValue(builder);
  });

  it('always scopes to discoverable + approved profiles, no filters given', async () => {
    await service.search();

    expect(mockDb).toHaveBeenCalledWith('candidate_profiles');
    expect(builder.where).toHaveBeenCalledWith({ discoverable: true, status: 'approved' });
    expect(builder.andWhereILike).not.toHaveBeenCalled();
    expect(builder.andWhere).not.toHaveBeenCalled();
  });

  it('applies role/location as ILIKE substring filters and remote as an exact match', async () => {
    await service.search({ role: 'engineer', location: 'austin', remote: 'remote' });

    expect(builder.andWhereILike).toHaveBeenCalledWith('search_role', '%engineer%');
    expect(builder.andWhereILike).toHaveBeenCalledWith('search_location', '%austin%');
    expect(builder.andWhere).toHaveBeenCalledWith({ search_remote: 'remote' });
  });

  it('caps limit at 100 regardless of what is requested', async () => {
    await service.search({ limit: 500 });
    expect(builder.limit).toHaveBeenCalledWith(100);
  });

  it('defaults limit to 25 and offset to 0', async () => {
    await service.search();
    expect(builder.limit).toHaveBeenCalledWith(25);
    expect(builder.offset).toHaveBeenCalledWith(0);
  });

  it('maps rows to the public-safe result shape and returns the total count', async () => {
    builder.rows = [
      { user_id: 'u1', profile_data: { headline: 'Senior Engineer' }, search_role: 'Engineering', search_location: 'Austin, TX', search_remote: 'hybrid' }
    ];
    builder.first.mockResolvedValueOnce({ n: '1' });

    const result = await service.search();

    expect(result).toEqual({
      results: [{ userId: 'u1', headline: 'Senior Engineer', role: 'Engineering', location: 'Austin, TX', remote: 'hybrid' }],
      total: 1
    });
  });

  it('falls back to an empty headline rather than throwing if profile_data is missing it', async () => {
    builder.rows = [{ user_id: 'u1', profile_data: {}, search_role: null, search_location: null, search_remote: null }];

    const result = await service.search();

    expect(result.results[0].headline).toBe('');
  });
});
