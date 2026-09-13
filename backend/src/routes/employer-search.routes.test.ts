jest.mock('../db/connection', () => ({ db: jest.fn() }));

// requireAuth/requireEmployer have their own dedicated coverage (middleware/auth.test.ts) —
// stubbed here to a trivial pass-through keyed off headers, same pattern as
// requisitions.routes.test.ts.
jest.mock('../middleware/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.header('x-test-user');
    if (!userId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session token provided' } });
      return;
    }
    req.userId = userId;
    req.user = { role: req.header('x-test-role') || 'employer' };
    next();
  },
  requireEmployer: (req: any, res: any, next: any) => {
    if (req.user?.role !== 'employer') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Employer access required' } });
      return;
    }
    next();
  }
}));

jest.mock('../services/candidate-search.service');

import express from 'express';
import request from 'supertest';
import { CandidateSearchService } from '../services/candidate-search.service';
import { errorHandler } from '../middleware/error-handler';
import employerSearchRoutes from './employer-search.routes';

const mockCandidateSearch = (CandidateSearchService as jest.MockedClass<typeof CandidateSearchService>).mock
  .instances[0] as jest.Mocked<CandidateSearchService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', employerSearchRoutes);
  app.use(errorHandler);
  return app;
}

describe('employer-search.routes GET /search', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  it('401s with no authenticated user', async () => {
    const res = await request(app).get('/search');
    expect(res.status).toBe(401);
    expect(mockCandidateSearch.search).not.toHaveBeenCalled();
  });

  it('403s for a non-employer role', async () => {
    const res = await request(app).get('/search').set('x-test-user', 'u1').set('x-test-role', 'user');
    expect(res.status).toBe(403);
    expect(mockCandidateSearch.search).not.toHaveBeenCalled();
  });

  it('passes through recognized filters and numeric pagination', async () => {
    mockCandidateSearch.search.mockResolvedValue({ results: [], total: 0 });

    const res = await request(app)
      .get('/search')
      .query({ role: 'engineer', location: 'austin', remote: 'hybrid', limit: '10', offset: '20' })
      .set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(mockCandidateSearch.search).toHaveBeenCalledWith({
      role: 'engineer',
      location: 'austin',
      remote: 'hybrid',
      limit: 10,
      offset: 20
    });
  });

  it('drops an unrecognized remote value rather than passing it through', async () => {
    mockCandidateSearch.search.mockResolvedValue({ results: [], total: 0 });

    await request(app).get('/search').query({ remote: 'anywhere' }).set('x-test-user', 'u1');

    expect(mockCandidateSearch.search).toHaveBeenCalledWith(
      expect.objectContaining({ remote: undefined })
    );
  });

  it('returns whatever the service finds', async () => {
    mockCandidateSearch.search.mockResolvedValue({
      results: [{ userId: 'u2', headline: 'Senior Engineer', role: 'Engineering', location: 'Remote', remote: 'remote' }],
      total: 1
    });

    const res = await request(app).get('/search').set('x-test-user', 'u1');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0].headline).toBe('Senior Engineer');
  });
});
