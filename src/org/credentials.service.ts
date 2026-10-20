// SPEC-011 PA-02a: credential and screening records. Expiry reminders are computed on read
// (shared credentialReminder) and never deactivate anyone — that is the facility's decision.
import { Inject, Injectable } from '@nestjs/common';
import type {
	Credential,
	CredentialCreateRequest,
	CredentialUpdateRequest,
	Id,
} from '@carekind/shared';
import { and, asc, eq } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { notFound } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DEFAULT_TIME_ZONE, todayIn } from '../common/dates.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, DbExecutor } from '../db/database.js';
import { credentials } from '../db/schema.js';
import { type CredentialRow, toCredential } from './org-mappers.js';
import { type AccessibleStaff, StaffAccessService } from './staff-access.service.js';

function present(row: CredentialRow): Credential {
	return toCredential(row, todayIn(DEFAULT_TIME_ZONE));
}

@Injectable()
export class CredentialsService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly staffAccess: StaffAccessService,
		private readonly audit: AuditService,
	) {}

	async list(actor: StaffPrincipal, staffId: Id): Promise<Credential[]> {
		await this.staffAccess.forRead(actor, staffId, this.db);
		const rows = await this.db
			.select()
			.from(credentials)
			.where(eq(credentials.staffId, staffId))
			.orderBy(asc(credentials.kind), asc(credentials.expiresAt));
		return rows.map(present);
	}

	async create(
		actor: StaffPrincipal,
		staffId: Id,
		body: CredentialCreateRequest,
	): Promise<Credential> {
		return this.db.transaction(async (tx) => {
			const target = await this.staffAccess.forWrite(actor, staffId, tx);
			const [row] = await tx
				.insert(credentials)
				.values({
					organisationId: actor.organisationId,
					staffId,
					kind: body.kind,
					reference: body.reference ?? null,
					expiresAt: body.expiresAt ?? null,
				})
				.returning();
			if (row === undefined) {
				throw new Error('Credential insert returned no row');
			}
			await this.record(tx, actor, target, row.id, 'credential.create', 'Added a credential');
			return present(row);
		});
	}

	async update(
		actor: StaffPrincipal,
		staffId: Id,
		credentialId: Id,
		body: CredentialUpdateRequest,
	): Promise<Credential> {
		return this.db.transaction(async (tx) => {
			const target = await this.staffAccess.forWrite(actor, staffId, tx);
			const [row] = await tx
				.update(credentials)
				.set({ ...body, updatedAt: new Date() })
				.where(and(eq(credentials.id, credentialId), eq(credentials.staffId, staffId)))
				.returning();
			if (row === undefined) {
				throw notFound('Credential');
			}
			await this.record(tx, actor, target, row.id, 'credential.update', 'Updated a credential');
			return present(row);
		});
	}

	async remove(actor: StaffPrincipal, staffId: Id, credentialId: Id): Promise<void> {
		await this.db.transaction(async (tx) => {
			const target = await this.staffAccess.forWrite(actor, staffId, tx);
			const deleted = await tx
				.delete(credentials)
				.where(and(eq(credentials.id, credentialId), eq(credentials.staffId, staffId)))
				.returning({ id: credentials.id });
			if (deleted.length === 0) {
				throw notFound('Credential');
			}
			await this.record(tx, actor, target, credentialId, 'credential.delete', 'Removed a credential');
		});
	}

	private async record(
		executor: DbExecutor,
		actor: StaffPrincipal,
		target: AccessibleStaff,
		credentialId: Id,
		action: string,
		summary: string,
	): Promise<void> {
		await this.audit.append(executor, {
			actor: auditActorOf(actor),
			organisationId: actor.organisationId,
			facilityId: target.auditFacilityId,
			action,
			entity: 'credential',
			entityId: credentialId,
			summary,
		});
	}
}
