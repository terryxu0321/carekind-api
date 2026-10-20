// SPEC-011 PA-05 go-live gate. The rule itself (all items done; NSW notice ≥ 14 days) lives in
// @carekind/shared canActivateFacility; this service only loads data and stores the outcome.
import { Inject, Injectable } from '@nestjs/common';
import {
	GOLIVE_ITEM_KEYS,
	type Facility,
	type GoLiveBlocker,
	type GoLiveItemKey,
	type GoLiveItemUpdateRequest,
	type GoLiveStatus,
	type Id,
	canActivateFacility,
	checkGoLiveItemUpdate,
} from '@carekind/shared';
import { and, eq } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { ApiError, conflict, notFound, validationFailed } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { todayIn } from '../common/dates.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, DbExecutor } from '../db/database.js';
import { facilities, goLiveItems } from '../db/schema.js';
import { type FacilityRow, OrgAccessService } from './org-access.service.js';
import { toFacility, toGoLiveItem } from './org-mappers.js';

function describeBlocker(blocker: GoLiveBlocker): string {
	switch (blocker.kind) {
		case 'item_incomplete':
			return `${blocker.key} not complete`;
		case 'notice_date_missing':
			return 'staff notice date missing';
		case 'notice_period_not_met':
			return `staff notice period ends ${blocker.earliestActivationDate}`;
	}
}

@Injectable()
export class GoLiveService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly audit: AuditService,
	) {}

	async status(actor: StaffPrincipal, facilityId: Id): Promise<GoLiveStatus> {
		const facility = await this.access.facilityFor(actor, facilityId, 'manage_go_live');
		return this.statusOf(this.db, facility);
	}

	async updateItem(
		actor: StaffPrincipal,
		facilityId: Id,
		key: GoLiveItemKey,
		body: GoLiveItemUpdateRequest,
	): Promise<GoLiveStatus> {
		const check = checkGoLiveItemUpdate(key, body);
		if (!check.ok) {
			throw validationFailed(check.reason);
		}
		return this.db.transaction(async (tx) => {
			const facility = await this.access.facilityFor(actor, facilityId, 'manage_go_live', tx);
			const now = new Date();
			const completion = body.completed
				? {
						completedAt: now,
						completedBy: actor.staffId,
						noticeSentOn: body.noticeSentOn ?? null,
					}
				: { completedAt: null, completedBy: null, noticeSentOn: null };
			await tx
				.update(goLiveItems)
				.set({ ...completion, updatedAt: now })
				.where(and(eq(goLiveItems.facilityId, facilityId), eq(goLiveItems.key, key)));
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'golive.item',
				entity: 'facility',
				entityId: facilityId,
				summary: `Marked go-live item ${key} as ${body.completed ? 'complete' : 'not complete'}`,
			});
			return this.statusOf(tx, facility);
		});
	}

	// 🛑 PA-05: recording may only be enabled once the gate passes; there is no override.
	async activate(actor: StaffPrincipal, facilityId: Id): Promise<Facility> {
		return this.db.transaction(async (tx) => {
			const facility = await this.access.facilityFor(actor, facilityId, 'manage_go_live', tx);
			if (facility.status !== 'configuring') {
				throw conflict(`Facility is ${facility.status}, not configuring`);
			}
			const status = await this.statusOf(tx, facility);
			if (!status.canActivate) {
				const reasons = status.blockers.map(describeBlocker).join('; ');
				throw new ApiError(
					'go_live_incomplete',
					`Go-live checklist is not complete: ${reasons}`,
				);
			}
			const [row] = await tx
				.update(facilities)
				.set({ status: 'live', updatedAt: new Date() })
				.where(eq(facilities.id, facilityId))
				.returning();
			if (row === undefined) {
				throw notFound('Facility');
			}
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'golive.activate',
				entity: 'facility',
				entityId: facilityId,
				summary: 'Activated facility (went live)',
			});
			return toFacility(row);
		});
	}

	private async statusOf(executor: DbExecutor, facility: FacilityRow): Promise<GoLiveStatus> {
		const rows = await executor
			.select()
			.from(goLiveItems)
			.where(eq(goLiveItems.facilityId, facility.id));
		// Checklist order as defined in shared (PA-05 template order).
		const items = rows
			.sort((a, b) => GOLIVE_ITEM_KEYS.indexOf(a.key) - GOLIVE_ITEM_KEYS.indexOf(b.key))
			.map(toGoLiveItem);
		const decision = canActivateFacility(items, facility.state, todayIn(facility.timezone));
		return {
			facilityId: facility.id,
			state: facility.state,
			status: facility.status,
			items,
			canActivate: decision.canActivate,
			blockers: decision.blockers,
		};
	}
}
