// SA-04a / PA-07 / code-rules P-7: every write is audited, the audit log is append-only at the
// database level, and summaries carry no resident names. Synthetic data only.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog } from '../src/db/schema.js';
import { type TestApi, requireKey, startTestApi } from './helpers.js';

let api: TestApi;

beforeAll(async () => {
	api = await startTestApi();
});

afterAll(async () => {
	await api.close();
});

async function rejection(statement: ReturnType<typeof sql>): Promise<unknown> {
	return api.db.execute(statement).then(
		() => null,
		(error: unknown) => error,
	);
}

describe('audit log', () => {
	it('should_append_one_entry_per_write_without_resident_names', async () => {
		const orgA = api.seed.organisations.orgA;
		const admin = api.client(await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'));
		const resident = await admin.org.createResident(requireKey(orgA.facilityIds, 'nsw1'), {
			givenName: 'Zebedee',
			familyName: 'Uniquename',
		});
		await admin.org.updateResident(resident.id, { room: 'Q9' });
		await admin.org.recordResidentEvent(resident.id, {
			type: 'admit',
			occurredAt: new Date().toISOString(),
		});
		await admin.org.updateConsent(resident.id, {
			status: 'consented',
			source: 'self',
			jurisdiction: 'NSW',
		});
		const entries = (await admin.org.listAudit()).filter(
			(entry) => entry.entityId === resident.id,
		);
		expect(entries.map((entry) => entry.action).sort()).toEqual(
			['consent.update', 'resident.create', 'resident.event', 'resident.update'].sort(),
		);
		for (const entry of entries) {
			expect(entry.summary).not.toMatch(/Zebedee|Uniquename|Q9|admit|consented/);
		}
	});

	it('should_reject_update_delete_and_truncate_in_the_database', async () => {
		const [before] = await api.db.select({ total: sql<number>`count(*)::int` }).from(auditLog);
		expect(before?.total).toBeGreaterThan(0);
		for (const statement of [
			sql`UPDATE audit_log SET summary = 'rewritten'`,
			sql`DELETE FROM audit_log`,
			sql`TRUNCATE audit_log`,
		]) {
			const error = await rejection(statement);
			expect(error).toBeInstanceOf(Error);
		}
		const [after] = await api.db.select({ total: sql<number>`count(*)::int` }).from(auditLog);
		expect(after?.total).toBe(before?.total);
	});
});
