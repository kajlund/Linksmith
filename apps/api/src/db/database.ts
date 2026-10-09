import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

export function createDatabase(
  connectionString: string,
  options?: pg.PoolConfig,
) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 15000,
    ...options,
  });
  const db = drizzle(pool, { schema });

  return { db, pool };
}
