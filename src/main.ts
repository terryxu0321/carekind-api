// Development server: PGlite database in a local folder, API on PORT (default 3000).
import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { loadConfig, loadDotEnv } from './config/app-config.js';
import { openDatabase } from './db/database.js';

async function main(): Promise<void> {
	loadDotEnv();
	const config = loadConfig(process.env);
	const database = await openDatabase(config.databaseDir);
	const app = await createApp({ db: database.db, config });
	app.enableShutdownHooks();
	await app.listen(config.port);
	new Logger('Main').log(`CareKind API listening on http://localhost:${config.port}`);
}

main().catch((error: unknown) => {
	console.error('API failed to start:', error instanceof Error ? error.message : error);
	process.exit(1);
});
