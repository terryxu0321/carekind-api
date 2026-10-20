// Settings come from environment variables only (code-rules CORE-03); .env.example lists the names.
import { existsSync } from 'node:fs';

export interface AppConfig {
	jwtSecret: string;
	port: number;
	databaseDir: string;
	// Invite links point at the facility admin console, which hosts the accept-invite page.
	adminWebUrl: string;
}

const JWT_SECRET_MIN_LENGTH = 32;
const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_DIR = '.data/pglite';
const DEFAULT_ADMIN_WEB_URL = 'http://localhost:5174';

// Node's built-in .env loader, so no dotenv dependency (CORE-11).
export function loadDotEnv(path = '.env'): void {
	if (existsSync(path)) {
		process.loadEnvFile(path);
	}
}

function optional(value: string | undefined, fallback: string): string {
	return value === undefined || value.trim() === '' ? fallback : value.trim();
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
	const jwtSecret = env.JWT_SECRET ?? '';
	if (jwtSecret.length < JWT_SECRET_MIN_LENGTH) {
		throw new Error(
			`JWT_SECRET must be set to at least ${JWT_SECRET_MIN_LENGTH} characters (see .env.example)`,
		);
	}
	const port = Number(optional(env.PORT, String(DEFAULT_PORT)));
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error('PORT must be a positive integer');
	}
	return {
		jwtSecret,
		port,
		databaseDir: optional(env.DATABASE_DIR, DEFAULT_DATABASE_DIR),
		adminWebUrl: optional(env.ADMIN_WEB_URL, DEFAULT_ADMIN_WEB_URL),
	};
}
