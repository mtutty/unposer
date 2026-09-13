import { Router } from 'express';
import { requireAuth, requireEmployer, AuthRequest } from '../middleware/auth';
import { CandidateSearchService } from '../services/candidate-search.service';

const router = Router();
const candidateSearch = new CandidateSearchService();

// Employer onboarding Phase 3 (docs/employer-onboarding-spec.md §5) — every route requires an
// authenticated, non-suspended user (requireAuth) with role 'employer' (requireEmployer, see
// middleware/auth.ts), same as requisitions.routes.ts. Separate route file/base path
// (/api/employer, matching the spec's own API sketch) rather than folded into
// requisitions.routes.ts — this isn't scoped to any one requisition.
router.use(requireAuth, requireEmployer);

router.get('/search', async (req: AuthRequest, res, next) => {
  try {
    const { role, location, remote, limit, offset } = req.query;
    const result = await candidateSearch.search({
      role: typeof role === 'string' ? role : undefined,
      location: typeof location === 'string' ? location : undefined,
      remote: remote === 'remote' || remote === 'hybrid' || remote === 'onsite' ? remote : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
