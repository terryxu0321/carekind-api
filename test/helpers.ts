// Test harness: a fresh in-memory PGlite database per test file, migrated and loaded with the
// synthetic seed (合成数据，仅用于开发与测试), served on a random local port. Requests go through
// the shared API client, so every response is also checked against the shared zod contract.
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import {
	type ApiClient,
	ApiError,
	type ApiErrorCode,
	type AuthAudience,
	createApiClient,
} from '@carekind/shared';
import { expect } from 'vitest';
import { createApp } from '../src/app.js';
import type { Database } from '../src/db/database.js';
import { openDatabase } from '../src/db/database.js';
import { type SeedResult, seedDatabase } from '../src/seed/seed-database.js';

export interface RawResponse {
	status: number;
	body: unknown;
}

export interface TestApi {
	baseUrl: string;
	db: Database;
	seed: SeedResult;
	password: string;
	login(email: string, audience: AuthAudience): Promise<string>;
	client(token: string | null): ApiClient;
	raw(method: string, path: string, options?: { token?: string; json?: unknown }): Promise<RawResponse>;
	close(): Promise<void>;
}

export async function startTestApi(): Promise<TestApi> {
	const database = await openDatabase();
	// Random per run, so no credential is written in the test code (CORE-03).
	const password = `${randomBytes(12).toString('base64url')}-Aa1`;
	const seed = await seedDatabase(database.db, password);
	const config = {
		jwtSecret: randomBytes(48).toString('base64url'),
		port: 0,
		databaseDir: '',
		adminWebUrl: 'http://localhost:5174',
	};
	const app: INestApplication = await createApp({ db: database.db, config }, ['error']);
	await app.listen(0, '127.0.0.1');
	const { port } = app.getHttpServer().address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${port}`;
	const tokens = new Map<string, string>();

	const client = (token: string | null): ApiClient =>
		createApiClient({ baseUrl, getToken: () => token });

	return {
		baseUrl,
		db: database.db,
		seed,
		password,
		client,
		async login(email, audience) {
			const cacheKey = `${audience}:${email}`;
			const cached = tokens.get(cacheKey);
			if (cached !== undefined) {
				return cached;
			}
			const session = await client(null).auth.login({ audience, email, password });
			tokens.set(cacheKey, session.accessToken);
			return session.accessToken;
		},
		async raw(method, path, options = {}) {
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (options.token !== undefined) {
				headers.Authorization = `Bearer ${options.token}`;
			}
			const response = await fetch(`${baseUrl}/api/v1${path}`, {
				method,
				headers,
				body: options.json === undefined ? undefined : JSON.stringify(options.json),
			});
			const text = await response.text();
			return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
		},
		async close() {
			await app.close();
			await database.close();
		},
	};
}

// Asserts that a client call fails with the given shared error code.
export async function expectApiError(call: Promise<unknown>, code: ApiErrorCode): Promise<void> {
	const error: unknown = await call.then(
		() => new Error('Expected the request to fail'),
		(failure: unknown) => failure,
	);
	expect(error).toBeInstanceOf(ApiError);
	expect((error as ApiError).code).toBe(code);
}

export function requireKey(map: Partial<Record<string, string>>, key: string): string {
	const value = map[key];
	if (value === undefined) {
		throw new Error(`Seed has no "${key}"`);
	}
	return value;
}
