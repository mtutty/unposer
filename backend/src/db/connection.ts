import knex from 'knex';
import knexConfig from './knex-config';

const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

export const db = knex(config);
