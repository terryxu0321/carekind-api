// SPEC-011 PA-03: resident register per facility. Status changes only through lifecycle events
// (resident-events.service.ts). Audit summaries never contain names (code-rules P-1).
import { Inject, Injectable } from '@nestjs/common';
import {
	type Id,
	type Resident,
	type ResidentDetail,
	type ResidentUpdateRequest,
	residentCreateRequestSchema,
} from '@carekind/shared';
import { and, asc, eq } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { conflict } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { residentEvents, residents } from '../db/schema.js';
import { OrgAccessService } from './org-access.service.js';
import { type ResidentRow, toResident, toResidentEvent } from './org-mappers.js';
import { ResidentAccessService, pendingTransferDestination } from './resident-access.service.js';

type CreateInput = ReturnType<typeof residentCreateRequestSchema.parse>;

@Injectable()
export class ResidentsService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly residentAccess: ResidentAccessService,
		private readonly audit: AuditService,
	) {}

	// Residents of the facility plus those transferring in, so the receiving facility can accept them.
	async list(actor: StaffPrincipal, facilityId: Id): Promise<Resident[]> {
		const facility = await this.access.facilityFor(actor, facilityId, 'manage_residents');
		const order = [asc(residents.familyName), asc(residents.givenName)];
		const own = await this.db
			.select()
			.from(residents)
			.where(eq(residents.facilityId, facility.id))
			.orderBy(...order);
		const incoming = await this.incomingTransfers(actor.organisationId, facility.id);
		return [...own, ...incoming].map(toResident);
	}

	async create(actor: StaffPrincipal, facilityId: Id, body: CreateInput): Promise<Resident> {
		return this.db.transaction(async (tx) => {
			await this.access.facilityFor(actor, facilityId, 'manage_residents', tx);
			const [row] = await tx
				.insert(residents)
				.values({
					organisationId: actor.organisationId,
					facilityId,
					givenName: body.givenName,
					preferredName: body.preferredName ?? null,
					familyName: body.familyName,
					room: body.room ?? null,
					status: body.status,
				})
				.returning();
			if (row === undefined) {
				throw new Error('Resident insert returned no row');
			}
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'resident.create',
				entity: 'resident',
				entityId: row.id,
				summary: 'Added resident to the register',
			});
			return toResident(row);
		});
	}

	async get(actor: StaffPrincipal, residentId: Id): Promise<ResidentDetail> {
		const row = await this.residentAccess.forAction(actor, residentId, 'manage_residents', this.db);
		const events = await this.db
			.select()
			.from(residentEvents)
			.where(eq(residentEvents.residentId, row.id))
			.orderBy(asc(residentEvents.occurredAt), asc(residentEvents.createdAt));
		return { ...toResident(row), events: events.map(toResidentEvent) };
	}

	// Archived records are read-only (SPEC-011 §3.1).
	async update(
		actor: StaffPrincipal,
		residentId: Id,
		body: ResidentUpdateRequest,
	): Promise<Resident> {
		return this.db.transaction(async (tx) => {
			const current = await this.residentAccess.forAction(
				actor,
				residentId,
				'manage_residents',
				tx,
			);
			if (current.status === 'archived') {
				throw conflict('Archived resident records are read-only');
			}
			const [row] = await tx
				.update(residents)
				.set({ ...body, updatedAt: new Date() })
				.where(eq(residents.id, residentId))
				.returning();
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId: current.facilityId,
				action: 'resident.update',
				entity: 'resident',
				entityId: residentId,
				summary: 'Updated resident details',
			});
			return toResident(row ?? current);
		});
	}

	private async incomingTransfers(organisationId: Id, facilityId: Id): Promise<ResidentRow[]> {
		const transferring = await this.db
			.select()
			.from(residents)
			.where(and(eq(residents.organisationId, organisationId), eq(residents.status, 'transferring')));
		const incoming: ResidentRow[] = [];
		for (const resident of transferring) {
			if (resident.facilityId === facilityId) {
				continue;
			}
			if ((await pendingTransferDestination(this.db, resident)) === facilityId) {
				incoming.push(resident);
			}
		}
		return incoming;
	}
}
