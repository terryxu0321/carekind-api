// `npm run seed`: loads 合成数据，仅用于开发与测试 into the local PGlite database (DATABASE_DIR).
// The password for every seeded account comes from SEED_PASSWORD in .env; it is never in code.
import { PASSWORD_MIN_LENGTH } from '@carekind/shared';
import { count } from 'drizzle-orm';
import { loadDotEnv } from '../config/app-config.js';
import { openDatabase } from '../db/database.js';
import { platformAdmins } from '../db/schema.js';
import { type SeedResult, seedDatabase } from './seed-database.js';

const DEFAULT_DATABASE_DIR = '.data/pglite';

function printLogins(result: SeedResult, databaseDir: string): void {
	console.log(`Seeded synthetic data into ${databaseDir}`);
	console.log('Sign-in password for every account below: the SEED_PASSWORD value in your .env');
	console.log(`  Super Admin (audience "platform"): ${result.platformAdminEmail}`);
	for (const [orgKey, organisation] of Object.entries(result.organisations)) {
		for (const [role, email] of Object.entries(organisation.emails)) {
			console.log(`  ${orgKey} ${role} (audience "org"): ${email}`);
		}
	}
}

async function main(): Promise<void> {
	loadDotEnv();
	const password = process.env.SEED_PASSWORD ?? '';
	if (password.length < PASSWORD_MIN_LENGTH) {
		throw new Error(`Set SEED_PASSWORD in .env (at least ${PASSWORD_MIN_LENGTH} characters)`);
	}
	const databaseDir = process.env.DATABASE_DIR?.trim() || DEFAULT_DATABASE_DIR;
	const database = await openDatabase(databaseDir);
	try {
		const [existing] = await database.db.select({ total: count() }).from(platformAdmins);
		if ((existing?.total ?? 0) > 0) {
			// The audit log is append-only, so reseeding means starting from an empty folder.
			console.log(`Already seeded. To start over, stop the API and delete ${databaseDir}.`);
			return;
		}
		printLogins(await seedDatabase(database.db, password), databaseDir);
	} finally {
		await database.close();
	}
}

main().catch((error: unknown) => {
	console.error('Seed failed:', error instanceof Error ? error.message : error);
	process.exit(1);
});
