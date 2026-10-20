// SPEC-011 PA-01: facilities of the caller's organisation.
import { Inject, Injectable } from '@nestjs/common';
import {
	type Facility,
	type FacilityCreateRequest,
	type FacilityUpdateRequest,
	GOLIVE_ITEM_KEYS,
	type Id,
	isFacilityLimitReached,
} from '@carekind/shared';
import { count, eq } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { ApiError, notFound } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { findOrganisation } from '../db/queries.js';
import { facilities, goLiveItems, workflowSettings } from '../db/schema.js';
import { toLimits } from '../platform/platform-mappers.js';
import { OrgAccessService, requireOrgAdminAction } from './org-access.service.js';
import { toFacility } from './org-mappers.js';
import { initialWorkflowSettings } from './workflow-defaults.js';

@Injectable()
export class FacilitiesService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly audit: AuditService,
	) {}

	async list(actor: StaffPrincipal): Promise<Facility[]> {
		return (await this.access.facilitiesWith(actor, 'view_overview')).map(toFacility);
	}

	async get(actor: StaffPrincipal, facilityId: Id): Promise<Facility> {
		return toFacility(await this.access.facilityFor(actor, facilityId, 'view_overview'));
	}

	// A new facility starts "configuring" with an empty go-live checklist (PA-05) and workflow
	// settings copied from the organisation's limits (PA-04).
	async create(actor: StaffPrincipal, body: FacilityCreateRequest): Promise<Facility> {
		requireOrgAdminAction(actor, 'create_facility');
		return this.db.transaction(async (tx) => {
			const organisation = await findOrganisation(tx, actor.organisationId);
			if (organisation === undefined) {
				throw notFound('Organisation');
			}
			const [existing] = await tx
				.select({ total: count() })
				.from(facilities)
				.where(eq(facilities.organisationId, organisation.id));
			if (isFacilityLimitReached(existing?.total ?? 0, organisation.facilityLimit)) {
				throw new ApiError(
					'limit_exceeded',
					'This organisation has reached its facility limit; contact CareKind to raise it',
				);
			}
			const [row] = await tx
				.insert(facilities)
				.values({ ...body, organisationId: organisation.id })
				.returning();
			if (row === undefined) {
				throw new Error('Facility insert returned no row');
			}
			const owned = { organisationId: organisation.id, facilityId: row.id };
			await tx.insert(goLiveItems).values(GOLIVE_ITEM_KEYS.map((key) => ({ ...owned, key })));
			await tx
				.insert(workflowSettings)
				.values({ ...owned, ...initialWorkflowSettings(toLimits(organisation)) });
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: organisation.id,
				facilityId: row.id,
				action: 'facility.create',
				entity: 'facility',
				entityId: row.id,
				summary: 'Created facility',
			});
			return toFacility(row);
		});
	}

	async update(
		actor: StaffPrincipal,
		facilityId: Id,
		body: FacilityUpdateRequest,
	): Promise<Facility> {
		return this.db.transaction(async (tx) => {
			await this.access.facilityFor(actor, facilityId, 'edit_facility', tx);
			const [row] = await tx
				.update(facilities)
				.set({ ...body, updatedAt: new Date() })
				.where(eq(facilities.id, facilityId))
				.returning();
			if (row === undefined) {
				throw notFound('Facility');
			}
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'facility.update',
				entity: 'facility',
				entityId: facilityId,
				summary: 'Updated facility details',
			});
			return toFacility(row);
		});
	}
}
