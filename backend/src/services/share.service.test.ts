jest.mock('../db/connection', () => ({ db: jest.fn() }));
import { db } from '../db/connection';

jest.mock('./progression.service');
import { ProgressionService } from './progression.service';

import { ShareService } from './share.service';

function makeBuilder() {
  const builder: any = {};
  builder.where = jest.fn(() => builder);
  builder.insert = jest.fn(() => builder);
  builder.returning = jest.fn();
  builder.first = jest.fn();
  builder.update = jest.fn();
  return builder;
}

describe('ShareService.createLink — flow addendum §7 tier gate', () => {
  let service: ShareService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGetTier = ProgressionService.prototype.getTier as jest.Mock;
  const mockGetTemporalDepthSummary = ProgressionService.prototype.getTemporalDepthSummary as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ShareService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
    builder.first.mockResolvedValue({ status: 'approved' }); // candidate_profiles lookup
  });

  it('rejects with TIER_TOO_LOW for a Sketch-tier profile, naming the still-thin dimensions', async () => {
    mockGetTier.mockResolvedValueOnce('sketch');
    mockGetTemporalDepthSummary.mockResolvedValueOnce({ dimensionsAtConfidence: ['openness'], singleSessionDimensions: [] });

    await expect(service.createLink('user-1', 14)).rejects.toMatchObject({
      code: 'TIER_TOO_LOW',
      details: expect.objectContaining({ tier: 'sketch', thinDimensions: expect.arrayContaining(['work_style']) })
    });
    expect(builder.insert).not.toHaveBeenCalled();
  });

  it.each(['core_persona', 'in_depth', 'ongoing'])('allows link creation at tier "%s"', async (tier) => {
    mockGetTier.mockResolvedValueOnce(tier);
    builder.returning.mockResolvedValueOnce([{ id: 'link-1', token: 'tok' }]);

    const link = await service.createLink('user-1', 14);

    expect(link).toEqual({ id: 'link-1', token: 'tok' });
  });

  it('never reaches the tier check when the profile is not approved', async () => {
    builder.first.mockResolvedValueOnce(undefined);

    await expect(service.createLink('user-1', 14)).rejects.toMatchObject({ code: 'PROFILE_NOT_APPROVED' });
    expect(mockGetTier).not.toHaveBeenCalled();
  });
});

describe('ShareService.setDiscoverable/getDiscoverable — employer onboarding Phase 3 (spec §5)', () => {
  let service: ShareService;
  let builder: ReturnType<typeof makeBuilder>;
  const mockDb = db as unknown as jest.Mock;
  const mockGetTier = ProgressionService.prototype.getTier as jest.Mock;
  const mockGetTemporalDepthSummary = ProgressionService.prototype.getTemporalDepthSummary as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ShareService();
    builder = makeBuilder();
    mockDb.mockReturnValue(builder);
  });

  it('getDiscoverable reads the flag off the candidate_profiles row, false if there is none', async () => {
    builder.first.mockResolvedValueOnce({ discoverable: true });
    await expect(service.getDiscoverable('user-1')).resolves.toBe(true);

    builder.first.mockResolvedValueOnce(undefined);
    await expect(service.getDiscoverable('user-1')).resolves.toBe(false);
  });

  it('turning it on applies the same tier gate as createLink', async () => {
    builder.first.mockResolvedValueOnce({ status: 'approved' }); // assertShareEligible's own lookup
    mockGetTier.mockResolvedValueOnce('sketch');
    mockGetTemporalDepthSummary.mockResolvedValueOnce({ dimensionsAtConfidence: [], singleSessionDimensions: [] });

    await expect(service.setDiscoverable('user-1', true)).rejects.toMatchObject({ code: 'TIER_TOO_LOW' });
    expect(builder.update).not.toHaveBeenCalled();
  });

  it('turning it on succeeds at Core persona or later', async () => {
    builder.first.mockResolvedValueOnce({ status: 'approved' });
    mockGetTier.mockResolvedValueOnce('core_persona');
    builder.update.mockResolvedValueOnce(1);

    await expect(service.setDiscoverable('user-1', true)).resolves.toBe(true);
    expect(builder.update).toHaveBeenCalledWith({ discoverable: true });
  });

  it('turning it off is never gated on tier, even for a thin profile', async () => {
    builder.update.mockResolvedValueOnce(1);

    await expect(service.setDiscoverable('user-1', false)).resolves.toBe(false);
    expect(mockGetTier).not.toHaveBeenCalled();
    expect(builder.update).toHaveBeenCalledWith({ discoverable: false });
  });

  it('404s if there is no profile row to update at all', async () => {
    builder.update.mockResolvedValueOnce(0);

    await expect(service.setDiscoverable('user-1', false)).rejects.toMatchObject({ code: 'PROFILE_NOT_APPROVED' });
  });
});
