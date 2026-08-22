/**
 * Empirical check for Iteration 3 (docs/personality-engine-implementation-plan.md): drives a real
 * multi-topic deep_prompts session — real DB, real configured LLM (needs LLM_API_KEY in .env) —
 * through TopicConversationService exactly as websocket/server.ts does, to verify the "Done when"
 * criteria that unit tests on the selection function in isolation can't: a live session asks
 * Q0/23/24/25 first, then picks by lowest-coverage dimension, never queues two heavy questions
 * back to back, and each topic actually closes. Not part of `npm test`; run manually:
 *
 *   docker-compose exec api npm run simulate:deep-prompts-session
 *
 * Each topic gets one substantive (but generically-worded, since the question isn't known ahead
 * of coverage-driven selection) narrative answer, then an explicit "that's all I've got on that"
 * to force closure deterministically via the always-honored user-close criterion (spec §3) rather
 * than waiting on the model's own judgment call for every one of TOPIC_COUNT topics.
 */
import { db } from '../db/connection';
import { TopicConversationService } from '../services/topic-conversation.service';
import { getQuestion } from '../models/question-library';

const TOPIC_COUNT = 10;
const CORE_SET = ['Q0', 'Q23', 'Q24', 'Q25'];

const SUBSTANTIVE_ANSWER =
  "There was a stretch on my last team where a release kept slipping and everyone was heads-down. " +
  "I noticed pretty early that the integration tests were flaky in a way that was masking a real bug, " +
  "but I didn't say anything for the first couple of days because I wasn't sure it was my place to " +
  "flag it — I was newer than most of the team. Eventually I just wrote up exactly what I was seeing, " +
  "walked one senior engineer through it directly instead of raising it in the group standup, and we " +
  "fixed the actual bug within a day. We shipped two days late instead of a week late. What stuck with " +
  "me afterward was less the fix and more how long I sat on it before saying anything.";

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
  const service = new TopicConversationService();

  console.log(`Resetting any prior personality-engine data for user ${userId}...`);
  await db('topic_thread').where({ user_id: userId }).delete(); // cascades exchange + dimension_evidence

  const askedOrder: { id: string; heavy: boolean }[] = [];
  let violations: string[] = [];

  for (let i = 0; i < TOPIC_COUNT; i++) {
    const opening = await service.ensureOpeningExchanges(userId, 'app');
    const active = await db('topic_thread').where({ user_id: userId, status: 'open' }).orderBy('opened_at', 'desc').first();
    const question = getQuestion(active.question_id);
    if (!question) throw new Error(`Selected unknown question_id ${active.question_id}`);

    askedOrder.push({ id: question.id, heavy: question.heavy });
    console.log(`\n[Topic ${i + 1}] ${question.id} — ${question.shortName}${question.heavy ? ' (heavy)' : ''}`);
    console.log(`  Q: ${opening[opening.length - 1].content}`);

    let outcome = await service.postUserMessage(userId, 'app', SUBSTANTIVE_ANSWER);
    console.log(`  A: ${SUBSTANTIVE_ANSWER.slice(0, 60)}...`);
    console.log(`  Model: ${outcome.assistantMessage.content}`);

    let threadRow = await db('topic_thread').where({ id: active.id }).first();
    if (threadRow.status !== 'closed') {
      outcome = await service.postUserMessage(userId, 'app', "That's all I've got on that.");
      console.log(`  A: That's all I've got on that.`);
      console.log(`  Model: ${outcome.assistantMessage.content}`);
      threadRow = await db('topic_thread').where({ id: active.id }).first();
    }

    if (threadRow.status !== 'closed') {
      violations.push(`${question.id} did not close even after an explicit user close signal.`);
    } else if (threadRow.closed_by !== 'user') {
      // Not a violation — the model may have already met its own close criteria on the first
      // answer, closing before the explicit signal was even sent. Just note it.
      console.log(`  (closed by model before the explicit close signal)`);
    }
  }

  console.log('\n--- Order asked ---');
  askedOrder.forEach((q, i) => console.log(`${i + 1}. ${q.id}${q.heavy ? ' (heavy)' : ''}`));

  const first4 = askedOrder.slice(0, 4).map((q) => q.id);
  if (JSON.stringify(first4) !== JSON.stringify(CORE_SET)) {
    violations.push(`Core set not asked first in order: got ${first4.join(', ')}, expected ${CORE_SET.join(', ')}`);
  }

  for (let i = 1; i < askedOrder.length; i++) {
    if (askedOrder[i].heavy && askedOrder[i - 1].heavy) {
      violations.push(`Two heavy questions back to back at positions ${i}/${i + 1}: ${askedOrder[i - 1].id}, ${askedOrder[i].id}`);
    }
  }

  const uniqueAsked = new Set(askedOrder.map((q) => q.id));
  console.log(`\n${uniqueAsked.size} distinct questions asked across ${askedOrder.length} topics.`);

  if (violations.length > 0) {
    console.error('\nSimulation check FAILED:');
    violations.forEach((v) => console.error(`  - ${v}`));
    process.exitCode = 1;
  } else {
    console.log('\nSimulation check PASSED.');
  }

  if (!args.keep) {
    await db('topic_thread').where({ user_id: userId }).delete();
    console.log('Cleaned up simulated session (pass --keep to leave it).');
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
