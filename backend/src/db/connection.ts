import knex from 'knex';
import { types } from 'pg';
import knexConfig from './knex-config';

// node-postgres parses DATE columns (OID 1082) into JS Date objects by default. That silently
// breaks every consumer that treats `exchange.occasion_id` (spec §5's "load-bearing" field) as
// the plain 'YYYY-MM-DD' string computeOccasionId() writes and every TS type in this codebase
// declares (Exchange.occasion_id: string, etc.): a `new Set(rows.map(r => r.occasion_id))` never
// dedupes, because two rows from the same calendar day each get their own distinct Date object
// instance, not the same string — found via Iteration 4's live-simulation check
// (docs/personality-engine-implementation-plan.md), where dimension_score.distinct_occasions
// grew every recompute even within a single same-day script run. Registering a raw-string parser
// for OID 1082 keeps DATE columns as exactly the string that was written, matching what every
// caller (topic-selection.service.ts's coverage counts, scoring-aggregation.service.ts's
// occasion grouping and variance classification, computeOccasionId itself) already assumes.
types.setTypeParser(1082, (val) => val);

const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

export const db = knex(config);
