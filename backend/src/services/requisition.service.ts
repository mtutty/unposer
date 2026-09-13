import { db } from '../db/connection';
import { AppError, JobRequisition } from '../types';

// Employer-side onboarding, Phase 1 (docs/employer-onboarding-spec.md §3) — plain structured-data
// CRUD, no AI call. Mirrors resume.service.ts's manual-entry shape in spirit (a recruiter typing
// fields, not uploading/parsing a file) but there's no confirmation-screen equivalent here: a
// requisition stays 'draft' until Phase 2's Q&A completes (not built yet), so nothing in Phase 1
// itself ever flips status off 'draft'.
export class RequisitionService {
  async list(userId: string): Promise<JobRequisition[]> {
    return db('job_requisitions').where({ user_id: userId }).orderBy('created_at', 'desc');
  }

  async create(userId: string, fields: { title: string; description: string; requirements?: string }): Promise<JobRequisition> {
    const [requisition] = await db('job_requisitions')
      .insert({
        user_id: userId,
        title: fields.title,
        description: fields.description,
        requirements: fields.requirements ?? null
      })
      .returning('*');
    return requisition;
  }

  /** Owner-only — a requisition is never visible to any employer but the one who created it in
   *  Phase 1 (no search/discovery surface exists yet; that's Phase 3). */
  async get(userId: string, id: string): Promise<JobRequisition> {
    const requisition = await db('job_requisitions').where({ id, user_id: userId }).first();
    if (!requisition) {
      throw new AppError('NOT_FOUND', 'Requisition not found', 404);
    }
    return requisition;
  }

  /** Editable only while 'draft' — once Phase 2's Q&A flips it 'active', the org/situational/
   *  cultural context captured there is presumed to describe the fields as they stood at that
   *  point, so silently changing title/description out from under it would leave that context
   *  stale. No such Q&A exists yet, so this only ever fires against a 'draft' row today, but the
   *  guard is cheap to have in place ahead of Phase 2. */
  async update(
    userId: string,
    id: string,
    changes: { title?: string; description?: string; requirements?: string }
  ): Promise<JobRequisition> {
    const existing = await this.get(userId, id);
    if (existing.status !== 'draft') {
      throw new AppError('NOT_DRAFT', 'Only a draft requisition can be edited', 400);
    }

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (changes.title !== undefined) updates.title = changes.title;
    if (changes.description !== undefined) updates.description = changes.description;
    if (changes.requirements !== undefined) updates.requirements = changes.requirements;

    const [requisition] = await db('job_requisitions').where({ id, user_id: userId }).update(updates).returning('*');
    return requisition;
  }
}
