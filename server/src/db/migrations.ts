import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import type { Database } from './database.js';
import { schemaMigrations } from './schema.js';

// Preserve existing SQL migration history and apply only pending upgrades.

export async function applyMigrations(
  db: Database,
  directory = fileURLToPath(new URL('../../migrations/', import.meta.url)),
) {
  const files = (await readdir(directory))
    .filter((name) => /^\d+_[\w-]+\.sql$/.test(name))
    .sort();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(73519200)`);
    await tx.execute(
      sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`,
    );
    for (const version of files) {
      const applied = await tx
        .select()
        .from(schemaMigrations)
        .where(eq(schemaMigrations.version, version));
      if (applied.length) continue;
      // Only trusted, version-controlled migration files are executed as raw SQL.
      const migration = await readFile(join(directory, version), 'utf8');
      await tx.execute(sql.raw(migration));
      await tx.insert(schemaMigrations).values({ version });
    }
  });
}
