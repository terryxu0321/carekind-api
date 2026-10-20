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
	await app.listen(config.port);
	const logger = new Logger('Main');
	logger.log(`CareKind API listening on http://localhost:${config.port}`);

	// PGlite keeps the database in a local folder; closing it cleanly on Ctrl+C keeps that folder
	// readable for the next start (a forced kill can leave it unusable).
	const shutdown = async (): Promise<void> => {
		logger.log('Stopping API and closing the database');
		await app.close();
		await database.close();
		process.exit(0);
	};
	process.once('SIGINT', () => void shutdown());
	process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
	console.error('API failed to start:', error instanceof Error ? error.message : error);
	process.exit(1);
});
