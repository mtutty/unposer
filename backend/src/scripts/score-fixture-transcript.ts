/**
 * Empirical check for Iteration 2 (docs/personality-engine-implementation-plan.md): runs a
 * hand-built fixture transcript — not live LLM traffic, not a real candidate — through the real
 * configured LLM (needs LLM_API_KEY in .env) to confirm the §4.3 prompt template actually fires
 * on obvious signal, for all 11 dimensions. Complements dimension-scoring.chain.test.ts, which
 * only checks the prompt is *built* correctly against a mocked LLM — this checks the prompt
 * *works* against a real one. Not part of `npm test`; run manually:
 *
 *   docker-compose exec api npm run score:fixture-transcript
 *
 * Each fixture pairs a question with an answer designed so its target dimension's rubric should
 * obviously fire in a specific direction (the plan's own example: "I love working alone" for Work
 * Style, included verbatim below). Exits non-zero if any fixture comes back with no evidence, a
 * null score, or evidence pointing the wrong direction.
 */
import { scoreDimension } from '../ai/dimension-scoring.chain';
import { DimensionKey } from '../types';

interface Fixture {
  dimension: DimensionKey;
  questionText: string;
  answerText: string;
  expectedDirection: 'low' | 'high';
}

const FIXTURES: Fixture[] = [
  {
    dimension: 'emotional_stability',
    questionText: 'Tell me about a high-pressure deadline. How did you handle it?',
    answerText:
      "We had 48 hours to fix a critical outage. I stayed pretty even the whole time — made a " +
      "list, delegated the noisy parts, and we shipped the fix with a few hours to spare. I " +
      "didn't feel much need to panic; there wasn't time for it and panicking wouldn't have helped.",
    expectedDirection: 'high'
  },
  {
    dimension: 'social_energy',
    questionText: 'How do you recharge after a long week?',
    answerText:
      'Honestly, a big dinner with twelve people is exactly how I recharge — I get more energy ' +
      'from being around a group than I lose from the work itself.',
    expectedDirection: 'high'
  },
  {
    dimension: 'dominance',
    questionText: 'Tell me about a time you disagreed with a decision at work.',
    answerText:
      "I pushed back hard in the room, said the plan was wrong, and pulled the group toward my " +
      "proposal instead. I don't mind being the one steering when I think I'm right.",
    expectedDirection: 'high'
  },
  {
    dimension: 'agreeableness',
    questionText: 'How do you handle conflict with a teammate?',
    answerText:
      "I usually give people the benefit of the doubt and look for the compromise that keeps " +
      "things friendly — I'd rather bend a little than have an ongoing fight.",
    expectedDirection: 'high'
  },
  {
    dimension: 'conscientiousness',
    questionText: 'Describe your approach to a new project.',
    answerText:
      "I build a detailed plan before I start anything — checklist, milestones, a tracker I " +
      "update daily. I don't really improvise; I like knowing exactly where things stand.",
    expectedDirection: 'high'
  },
  {
    dimension: 'openness',
    questionText: 'Tell me about something new you learned recently.',
    answerText:
      'I spent a weekend teaching myself a totally unrelated field just because I was curious ' +
      'where the ideas would lead — I love chasing a new domain even when it has nothing to do ' +
      'with my job.',
    expectedDirection: 'high'
  },
  {
    dimension: 'change_orientation',
    questionText: 'How do you feel about a reorg with no clear plan yet?',
    answerText:
      "Honestly I find that exciting — ambiguity means there's room to shape it. I'd rather move " +
      'into the unknown fast than wait for someone to hand me a stable plan.',
    expectedDirection: 'high'
  },
  {
    // Q23, "The Gut Call" — real library text (see models/question-library.ts).
    dimension: 'thinking_style',
    questionText:
      'Tell me about a call you made where the data pointed one way and your instinct pointed ' +
      'the other. Which did you follow? And knowing how it turned out — do you trust yourself ' +
      'more or less on that kind of call now?',
    answerText:
      'The data said ship it, but I held off because my gut said something was off — I went back ' +
      "and reran the analysis with a different segmentation before deciding. I don't trust a " +
      'headline number without checking it myself.',
    expectedDirection: 'high'
  },
  {
    // Q24, "The Thing You'd Catch" — real library text.
    dimension: 'detail_orientation',
    questionText:
      "When you're reviewing someone else's work — a doc, a design, a pull request — what do you " +
      "notice first? And what's the thing you know you consistently miss that someone else on " +
      'the team always catches?',
    answerText:
      "When I review a PR I go line by line — I'll catch a missing null check or an off-by-one " +
      'before anything else. What I know I miss is the big-picture "does this even solve the ' +
      'right problem" question — someone else always catches that.',
    expectedDirection: 'high'
  },
  {
    dimension: 'motivation',
    questionText: 'What drives you at work?',
    answerText:
      "I'm restless about growth — I'm always looking for the next stretch goal, and I get " +
      "uncomfortable if I feel like I've plateaued for more than a few months.",
    expectedDirection: 'high'
  },
  {
    // Q25, "The Balance You Got Wrong" — real library text. Includes the plan's own example
    // phrase verbatim ("I love working alone").
    dimension: 'work_style',
    questionText:
      'In an ideal week, how much of your time is you alone with a problem versus you in a room ' +
      'with other people? Now tell me about a stretch of work where that balance was badly ' +
      'wrong — in either direction — and what it did to you.',
    answerText:
      "I love working alone, always have. In an ideal week it's almost no meetings — just me and " +
      'a hard problem. The one stretch where that balance was wrong was a quarter with ' +
      "back-to-back workshops; I got nothing done and it wore me down fast.",
    expectedDirection: 'low'
  }
];

async function main() {
  let failures = 0;

  for (const fixture of FIXTURES) {
    process.stdout.write(`${fixture.dimension.padEnd(22)} `);
    const result = await scoreDimension(fixture);

    const hasEvidence = result.evidence.length > 0;
    const hasScore = result.provisionalScore !== null;
    const rightDirection = result.evidence.some((e) => e.direction === fixture.expectedDirection);
    const ok = hasEvidence && hasScore && rightDirection;

    if (!ok) failures++;

    console.log(
      `${ok ? 'PASS' : 'FAIL'}  score=${result.provisionalScore ?? 'null'} confidence=${result.confidence} ` +
        `evidence=${result.evidence.length} expectedDirection=${fixture.expectedDirection}`
    );
    if (!ok || process.env.VERBOSE) {
      result.evidence.forEach((e) => console.log(`    [${e.direction}/${e.strength}] "${e.span}" (${e.facet})`));
      console.log(`    reasoning: ${result.reasoning}`);
    }
  }

  console.log(`\n${FIXTURES.length - failures}/${FIXTURES.length} fixtures fired as expected.`);
  if (failures > 0) throw new Error(`${failures} fixture(s) did not fire as expected — see FAIL lines above.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
