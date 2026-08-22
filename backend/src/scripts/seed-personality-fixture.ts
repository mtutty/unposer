/**
 * Throwaway fixture for the personality-engine tables added in Iteration 1 (see
 * docs/personality-engine-implementation-plan.md) — not a real seed, just a way to prove the
 * topic_thread -> exchange -> dimension_evidence chain round-trips through the new migrations
 * with correct occasion_ids, without waiting for the chains/services that will eventually write
 * these rows for real (Iteration 2+). Run inside the API container, same as
 * simulate-inbound-email.ts:
 *
 *   docker-compose exec api npm run seed:personality-fixture -- --user devuser@example.com
 *
 * Inserts one topic_thread for question 'Q0' with three exchanges spread across three distinct
 * simulated days, one dimension_evidence row per exchange, then reads everything back and
 * verifies: 3 distinct occasion_ids, each dimension_evidence row correctly joined to its
 * exchange. Deletes its own rows at the end (topic_thread cascade takes exchange and
 * dimension_evidence with it) unless --keep is passed.
 */
import { db } from '../db/connection';
import { computeOccasionId } from '../utils/occasion';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function resolveUserId(args: Record<string, string | boolean>): Promise<string> {
  const email = typeof args.user === 'string' ? args.user : 'devuser@example.com';
  const user = await db('users').where({ email }).first();
  if (!user) {
    throw new Error(`No user with email ${email} — run dev login first, or pass --user <email>.`);
  }
  return user.id;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userId = await resolveUserId(args);

  console.log(`Seeding personality fixture for user ${userId}...`);

  const [thread] = await db('topic_thread')
    .insert({ user_id: userId, question_id: 'Q0', status: 'open' })
    .returning('*');
  console.log(`  topic_thread ${thread.id} opened`);

  // Three simulated days, one exchange pair (assistant question + user answer) evidenced per day.
  const simulatedDays = [
    new Date('2026-08-01T15:00:00Z'),
    new Date('2026-08-08T15:00:00Z'),
    new Date('2026-08-15T15:00:00Z')
  ];

  const evidenceIds: string[] = [];
  const occasionIds = new Set<string>();

  for (const sentAt of simulatedDays) {
    const occasionId = computeOccasionId(sentAt);
    occasionIds.add(occasionId);

    const [exchange] = await db('exchange')
      .insert({
        thread_id: thread.id,
        role: 'user',
        text: `Fixture answer for ${occasionId} — the team rewarded people who caught problems early.`,
        sent_at: sentAt,
        channel: 'app',
        occasion_id: occasionId
      })
      .returning('*');

    const [evidence] = await db('dimension_evidence')
      .insert({
        exchange_id: exchange.id,
        dimension: 'agreeableness',
        span: 'the team rewarded people who caught problems early',
        direction: 'high',
        strength: 'moderate',
        type: 'behavioral_report',
        facet: 'trust',
        note: 'Fixture row — seed-personality-fixture.ts'
      })
      .returning('*');

    evidenceIds.push(evidence.id);
    console.log(`  exchange ${exchange.id} (occasion_id=${exchange.occasion_id}) -> dimension_evidence ${evidence.id}`);
  }

  // Read back and verify.
  const readBack = await db('dimension_evidence')
    .join('exchange', 'exchange.id', 'dimension_evidence.exchange_id')
    .where('exchange.thread_id', thread.id)
    .select('dimension_evidence.id as evidence_id', 'exchange.occasion_id');

  const distinctOccasions = new Set(readBack.map((r) => r.occasion_id.toISOString().slice(0, 10)));

  console.log(`\nRead back ${readBack.length} evidence rows across ${distinctOccasions.size} distinct occasion_ids.`);

  if (readBack.length !== 3 || distinctOccasions.size !== 3) {
    throw new Error(`Fixture check FAILED: expected 3 rows / 3 distinct occasions, got ${readBack.length} / ${distinctOccasions.size}`);
  }
  console.log('Fixture check PASSED.');

  if (!args.keep) {
    await db('topic_thread').where({ id: thread.id }).delete(); // cascades exchange + dimension_evidence
    console.log('Cleaned up fixture rows (pass --keep to leave them).');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
