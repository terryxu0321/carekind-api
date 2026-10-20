// SPEC-010 SA-01 / SA-02: organisation (tenant) lifecycle and per-organisation limits.
import { Inject, Injectable } from '@nestjs/common';
import type {
	FacilitySummary,
	Id,
	Organisation,
	OrganisationCreateRequest,
	OrganisationLimits,
	OrganisationStatus,
	OrganisationUpdateRequest,
} from '@carekind/shared';
import { asc, eq } from 'drizzle-orm';
import type { PlatformPrincipal } from '../auth/principal.js';
import { auditActorOf } from '../auth/principal.js';
import { conflict, notFound } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, DbExecutor } from '../db/database.js';
import { type OrganisationRow, currentPlatformDefaults, findOrganisation } from '../db/queries.js';
import { facilities, organisations } from '../db/schema.js';
import { toFacilitySummary, toOrganisation } from './platform-mappers.js';

export async function requireOrganisation(
	executor: DbExecutor,
	organisationId: Id,
): Promise<OrganisationRow> {
	const organisation = await findOrganisation(executor, organisationId);
	if (organisation === undefined) {
		throw notFound('Organisation');
	}
	return organisation;
}

@Injectable()
export class OrganisationsService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly audit: AuditService,
	) {}

	async list(): Promise<Organisation[]> {
		const rows = await this.db.select().from(organisations).orderBy(asc(organisations.name));
		return rows.map(toOrganisation);
	}

	async get(organisationId: Id): Promise<Organisation> {
		return toOrganisation(await requireOrganisation(this.db, organisationId));
	}

	// SA-02a: a new organisation starts with a copy of the platform defaults.
	async create(actor: PlatformPrincipal, body: OrganisationCreateRequest): Promise<Organisation> {
		return this.db.transaction(async (tx) => {
			const limits = await currentPlatformDefaults(tx);
			const [row] = await tx
				.insert(organisations)
				.values({ ...body, ...limits })
				.returning();
			if (row === undefined) {
				throw new Error('Organisation insert returned no row');
			}
			await this.record(tx, actor, row.id, 'organisation.create', 'Created organisation');
			return toOrganisation(row);
		});
	}

	async update(
		actor: PlatformPrincipal,
		organisationId: Id,
		body: OrganisationUpdateRequest,
	): Promise<Organisation> {
		return this.updateRow(actor, organisationId, body, 'organisation.update', 'Updated details');
	}

	// SA-01: suspending blocks every sign-in of that organisation; data is kept, never deleted.
	async setStatus(
		actor: PlatformPrincipal,
		organisationId: Id,
		status: OrganisationStatus,
	): Promise<Organisation> {
		const current = await requireOrganisation(this.db, organisationId);
		if (current.status === status) {
			throw conflict(`Organisation is already ${status}`);
		}
		const action = status === 'suspended' ? 'organisation.suspend' : 'organisation.reactivate';
		const summary = status === 'suspended' ? 'Suspended organisation' : 'Reactivated organisation';
		return this.updateRow(actor, organisationId, { status }, action, summary);
	}

	async updateLimits(
		actor: PlatformPrincipal,
		organisationId: Id,
		limits: OrganisationLimits,
	): Promise<Organisation> {
		return this.updateRow(actor, organisationId, limits, 'organisation.limits', 'Updated limits');
	}

	// SA-01: the platform sees facility name, state and status only.
	async listFacilities(organisationId: Id): Promise<FacilitySummary[]> {
		await requireOrganisation(this.db, organisationId);
		const rows = await this.db
			.select()
			.from(facilities)
			.where(eq(facilities.organisationId, organisationId))
			.orderBy(asc(facilities.name));
		return rows.map(toFacilitySummary);
	}

	private async updateRow(
		actor: PlatformPrincipal,
		organisationId: Id,
		changes: Partial<typeof organisations.$inferInsert>,
		action: string,
		summary: string,
	): Promise<Organisation> {
		return this.db.transaction(async (tx) => {
			const [row] = await tx
				.update(organisations)
				.set({ ...changes, updatedAt: new Date() })
				.where(eq(organisations.id, organisationId))
				.returning();
			if (row === undefined) {
				throw notFound('Organisation');
			}
			await this.record(tx, actor, row.id, action, summary);
			return toOrganisation(row);
		});
	}

	private async record(
		executor: DbExecutor,
		actor: PlatformPrincipal,
		organisationId: Id,
		action: string,
		summary: string,
	): Promise<void> {
		await this.audit.append(executor, {
			actor: auditActorOf(actor),
			organisationId,
			action,
			entity: 'organisation',
			entityId: organisationId,
			summary,
		});
	}
}
