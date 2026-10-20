// PGlite = PostgreSQL compiled to WebAssembly, installed from npm (tech design §1: no Docker).
// The same Drizzle code can later point at a managed PostgreSQL through the `pg` driver.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { type PgliteDatabase, drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.js';

export type Database = PgliteDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
// Services accept either, so several writes and their audit row can share one transaction.
export type DbExecutor = Database | Transaction;

// src/db and dist/db are both two levels below the package root.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface DatabaseHandle {
	db: Database;
	close: () => Promise<void>;
}

// No dataDir → in-memory database (tests). A dataDir persists to a local, gitignored folder.
export async function openDatabase(dataDir?: string): Promise<DatabaseHandle> {
	if (dataDir !== undefined) {
		mkdirSync(dataDir, { recursive: true });
	}
	const client = new PGlite(dataDir);
	const db = drizzle({ client, schema });
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return { db, close: () => client.close() };
}
