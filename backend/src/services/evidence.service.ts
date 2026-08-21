import { db } from '../db/connection';
import { embedText, embedTexts } from '../ai/embeddings';
import { LogisticsData, Message, ProfileData, ResumeStructuredData } from '../types';

// Threshold for "the distilled profile tier already answers this well enough" — cosine
// similarity (1 - cosine distance), so higher is more similar. Empirically-tuned starting point,
// not derived from anything; expect to revisit once there's real query data (see search below).
const DISTILLED_SUFFICIENT_THRESHOLD = 0.5;

export interface EvidenceHit {
  id: string;
  tier: 'profile' | 'conversation';
  content: string;
  similarity: number;
  metadata: Record<string, any>;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Powers candidate-evidence semantic search for sandbox/share chat (see
 * ai/evidence-search.tool.ts) — retrieval beyond the compact profile digest already sent as
 * context every turn. Two tiers, stored in separate tables on purpose (see the migrations'
 * comments): `profile_evidence` (distilled, always-current, authoritative) and
 * `conversation_evidence` (raw substrate, historical, supplementary). search() below keeps that
 * distinction structural rather than a similarity-score coincidence.
 */
export class EvidenceService {
  // -------------------------------------------------------------------------
  // Population — one method per source, each called from the write path that
  // finalizes that data (see call sites: resume.service.ts, conversation.service.ts,
  // profile.service.ts). Callers are responsible for catching failures here and
  // logging-and-continuing — indexing is a supplement, never a gate on the core flow.
  // -------------------------------------------------------------------------

  async indexResumeSubstrate(userId: string, resumeId: string, resume: ResumeStructuredData): Promise<void> {
    const chunks: { content: string; metadata: Record<string, any> }[] = [];

    for (const job of resume.workHistory) {
      chunks.push({
        content: `${job.title} at ${job.company} (${job.startDate}–${job.endDate}): ${job.description} ${job.highlights.join('; ')}`,
        metadata: { company: job.company, title: job.title }
      });
    }

    const skillsBlock = [
      resume.skills.length ? `Skills: ${resume.skills.join(', ')}` : '',
      resume.certifications.length ? `Certifications: ${resume.certifications.join(', ')}` : '',
      resume.education.length
        ? `Education: ${resume.education.map((e) => `${e.degree} in ${e.field}, ${e.institution} (${e.graduationYear})`).join('; ')}`
        : ''
    ]
      .filter(Boolean)
      .join(' ');
    if (skillsBlock) chunks.push({ content: skillsBlock, metadata: { section: 'skills' } });

    const summaryBlock = [
      resume.summary,
      resume.changeMotivation ? `Change motivation: ${resume.changeMotivation}` : '',
      resume.movingToward ? `Moving toward: ${resume.movingToward}` : '',
      resume.transferableSkills?.length ? `Transferable skills: ${resume.transferableSkills.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join(' ');
    if (summaryBlock) chunks.push({ content: summaryBlock, metadata: { section: 'summary' } });

    // Delete-and-reinsert: a resume re-confirmation (correction) replaces prior chunks rather
    // than leaving stale ones alongside fresh ones.
    await db('conversation_evidence').where({ user_id: userId, source_type: 'resume' }).delete();
    await this.insertSubstrate(userId, 'resume', resumeId, chunks);
  }

  async indexLogisticsSubstrate(userId: string, data: LogisticsData): Promise<void> {
    const content = Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('. ');
    if (!content) return;

    await db('conversation_evidence').where({ user_id: userId, source_type: 'logistics' }).delete();
    await this.insertSubstrate(userId, 'logistics', null, [{ content, metadata: {} }]);
  }

  async indexDeepPromptSubstrate(userId: string, userMsg: Message, assistantMsg: Message): Promise<void> {
    const content = `Q: ${assistantMsg.content}\nA: ${userMsg.content}`;
    await this.insertSubstrate(userId, 'deep_prompt_turn', assistantMsg.id, [{ content, metadata: {} }]);
  }

  async indexDistilledProfile(userId: string, profileData: ProfileData): Promise<void> {
    const rows: { kind: string; source_ref: string; content: string }[] = [];

    for (const insight of profileData.insights) {
      rows.push({
        kind: 'insight',
        source_ref: insight.id,
        content: `${insight.category}: ${insight.statement} — ${insight.evidence}`
      });
    }
    profileData.starStories.forEach((story, i) => {
      rows.push({
        kind: 'star_story',
        source_ref: `star-${i}`,
        content: `Situation: ${story.situation} Task: ${story.task} Action: ${story.action} Result: ${story.result}`
      });
    });

    // Wholesale replace — profile_evidence is meant to always equal "the current profile," and
    // candidate_profiles is 1-row-per-user with no version history, so a prior version has no
    // reader anyway (see the migration's comment).
    await db('profile_evidence').where({ user_id: userId }).delete();
    if (rows.length === 0) return;

    const embeddings = await embedTexts(rows.map((r) => r.content));
    await db('profile_evidence').insert(
      rows.map((r, i) => ({
        user_id: userId,
        kind: r.kind,
        source_ref: r.source_ref,
        content: r.content,
        embedding: toVectorLiteral(embeddings[i]),
        metadata: {}
      }))
    );
  }

  private async insertSubstrate(
    userId: string,
    sourceType: string,
    sourceId: string | null,
    chunks: { content: string; metadata: Record<string, any> }[]
  ): Promise<void> {
    if (chunks.length === 0) return;
    const embeddings = await embedTexts(chunks.map((c) => c.content));
    await db('conversation_evidence').insert(
      chunks.map((c, i) => ({
        user_id: userId,
        source_type: sourceType,
        source_id: sourceId,
        content: c.content,
        embedding: toVectorLiteral(embeddings[i]),
        metadata: c.metadata
      }))
    );
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Two-phase, distilled-preferred: queries profile_evidence first; only reaches into
   * conversation_evidence to fill out remaining results (or when the distilled tier's best match
   * isn't confident enough on its own). Distilled hits are always ranked ahead of raw ones in the
   * returned list, regardless of their relative cosine scores — see the tables' migration
   * comments for why this is a structural choice, not a ranking tweak.
   */
  async search(userId: string, query: string, k = 5): Promise<EvidenceHit[]> {
    const embedding = await embedText(query);
    const vector = toVectorLiteral(embedding);

    const distilled = await this.queryProfileEvidence(userId, vector, k);

    if (distilled.length >= k && distilled[0].similarity >= DISTILLED_SUFFICIENT_THRESHOLD) {
      return distilled;
    }

    const raw = await this.queryConversationEvidence(userId, vector, k - distilled.length + 2);
    return [...distilled, ...raw].slice(0, k);
  }

  private async queryProfileEvidence(userId: string, vector: string, k: number): Promise<EvidenceHit[]> {
    const result = await db.raw(
      `SELECT id, content, metadata, 1 - (embedding <=> ?::vector) AS similarity
       FROM profile_evidence
       WHERE user_id = ?
       ORDER BY embedding <=> ?::vector
       LIMIT ?`,
      [vector, userId, vector, k]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      tier: 'profile' as const,
      content: row.content,
      similarity: Number(row.similarity),
      metadata: row.metadata
    }));
  }

  private async queryConversationEvidence(userId: string, vector: string, k: number): Promise<EvidenceHit[]> {
    if (k <= 0) return [];
    const result = await db.raw(
      `SELECT id, content, metadata, 1 - (embedding <=> ?::vector) AS similarity
       FROM conversation_evidence
       WHERE user_id = ?
       ORDER BY embedding <=> ?::vector
       LIMIT ?`,
      [vector, userId, vector, k]
    );
    return result.rows.map((row: any) => ({
      id: row.id,
      tier: 'conversation' as const,
      content: row.content,
      similarity: Number(row.similarity),
      metadata: row.metadata
    }));
  }
}
