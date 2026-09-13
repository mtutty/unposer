import { db } from '../db/connection';
import { RequisitionCultureSignal } from '../types';
import { inferRequisitionCultureSignals } from '../ai/requisition-culture-signal.chain';

// Employer-side onboarding, Phase 2's CVF-quadrant decision (docs/employer-onboarding-spec.md
// §4, 2026-09-12). Mirrors culture-signal.service.ts's regenerate() shape exactly — wholesale
// replace, so a since-superseded read never outranks the current one — but sources from every
// employer message in the requisition's Q&A thread rather than three named library questions
// (this step has no question library, just one open conversation — see requisition-qa.ts).
export class RequisitionCultureSignalService {
  async regenerate(requisitionId: string): Promise<RequisitionCultureSignal[]> {
    const sources = await this.loadSources(requisitionId);
    const signals = sources.length > 0 ? await inferRequisitionCultureSignals(sources) : [];

    await db('requisition_culture_signal').where({ requisition_id: requisitionId }).delete();
    if (signals.length === 0) return [];

    return db('requisition_culture_signal')
      .insert(
        signals.map((s) => ({
          requisition_id: requisitionId,
          cvf_quadrant: s.quadrant,
          source_message_ids: JSON.stringify(s.sourceMessageIds)
        }))
      )
      .returning('*');
  }

  private async loadSources(requisitionId: string): Promise<Array<{ messageId: string; text: string }>> {
    const messages: { id: string; content: string }[] = await db('requisition_messages')
      .where({ requisition_id: requisitionId, role: 'user' })
      .select('id', 'content');

    return messages.map((m) => ({ messageId: m.id, text: m.content }));
  }
}
