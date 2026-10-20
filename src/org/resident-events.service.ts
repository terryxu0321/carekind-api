// SPEC-011 §3.1 resident lifecycle. The transition table and the consent-reset rule live in
// @carekind/shared (nextResidentStatus, eventResetsConsent); this service applies them.
// Only in_residence residents are attribution candidates, so a wrong status widens H-03.
import { Inject, Injectable } from '@nestjs/common';
import {
	type Id,
	type ResidentEventCreateRequest,
	type ResidentEventResult,
	eventResetsConsent,
	nextResidentStatus,
} from '@carekind/shared';
import { eq } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { ApiError, validationFailed } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, Transaction } from '../db/database.js';
import { consents, residentEvents, residents } from '../db/schema.js';
import { type FacilityRow, OrgAccessService, requireFacilityAction } from './org-access.service.js';
import { type ResidentRow, toResident, toResidentEvent } from './org-mappers.js';
import { ResidentAccessService, pendingTransferDestination } from './resident-access.service.js';

interface Movement {
	fromFacility: FacilityRow;
	// Set for transfer_out (destination) and transfer_accept (new home); null otherwise.
	toFacility: FacilityRow | null;
}

@Injectable()
export class ResidentEventsService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly residentAccess: ResidentAccessService,
		private readonly audit: AuditService,
	) {}

	async record(
		actor: StaffPrincipal,
		residentId: Id,
		body: ResidentEventCreateRequest,
	): Promise<ResidentEventResult> {
		return this.db.transaction(async (tx) => {
			const resident = await this.residentAccess.find(actor, residentId, tx);
			const movement = await this.resolveMovement(tx, actor, resident, body);
			// The receiving facility accepts a transfer; every other event belongs to the current one.
			const actingFacility =
				body.type === 'transfer_accept' ? movement.toFacility : movement.fromFacility;
			requireFacilityAction(actor, (actingFacility ?? movement.fromFacility).id, 'manage_residents');
			const next = nextResidentStatus(resident.status, body.type);
			if (!next.ok) {
				throw new ApiError('invalid_transition', next.reason);
			}
			const isAccepted = body.type === 'transfer_accept' && movement.toFacility !== null;
			const homeFacilityId = isAccepted ? (movement.toFacility?.id ?? resident.facilityId) : resident.facilityId;
			const [updated] = await tx
				.update(residents)
				.set({
					status: next.value,
					facilityId: homeFacilityId,
					// A room number belongs to the old facility, so it is cleared on arrival.
					room: isAccepted ? null : resident.room,
					updatedAt: new Date(),
				})
				.where(eq(residents.id, resident.id))
				.returning();
			const [event] = await tx
				.insert(residentEvents)
				.values({
					organisationId: actor.organisationId,
					residentId: resident.id,
					type: body.type,
					fromFacilityId: movement.fromFacility.id,
					toFacilityId: movement.toFacility?.id ?? null,
					occurredAt: new Date(body.occurredAt),
					recordedBy: actor.staffId,
				})
				.returning();
			if (updated === undefined || event === undefined) {
				throw new Error('Resident event was not stored');
			}
			const consentReset = eventResetsConsent(body.type);
			if (consentReset) {
				await this.resetConsent(tx, actor, resident.id);
			}
			// Summary stays generic: the event type itself (e.g. death, leave) is health-related (P-1).
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId: homeFacilityId,
				action: 'resident.event',
				entity: 'resident',
				entityId: resident.id,
				summary: 'Recorded a resident lifecycle event',
			});
			return {
				resident: toResident(updated),
				event: toResidentEvent(event),
				consentReset,
				// SPEC-011 §3.1 / SPEC-009: a new state's rules apply, so the UI asks to re-confirm consent.
				crossStateTransfer:
					isAccepted && movement.toFacility?.state !== movement.fromFacility.state,
			};
		});
	}

	private async resolveMovement(
		tx: Transaction,
		actor: StaffPrincipal,
		resident: ResidentRow,
		body: ResidentEventCreateRequest,
	): Promise<Movement> {
		const fromFacility = await this.access.findFacility(actor, resident.facilityId, tx);
		if (body.type === 'transfer_out') {
			return { fromFacility, toFacility: await this.transferDestination(tx, actor, resident, body) };
		}
		if (body.type === 'transfer_accept') {
			const destinationId = await pendingTransferDestination(tx, resident);
			const toFacility =
				destinationId === null ? null : await this.access.findFacility(actor, destinationId, tx);
			return { fromFacility, toFacility };
		}
		return { fromFacility, toFacility: null };
	}

	// Transfers stay within the organisation (SPEC-011 §3.1 "同公司内").
	private async transferDestination(
		tx: Transaction,
		actor: StaffPrincipal,
		resident: ResidentRow,
		body: ResidentEventCreateRequest,
	): Promise<FacilityRow> {
		if (body.toFacilityId === undefined || body.toFacilityId === resident.facilityId) {
			throw validationFailed('toFacilityId must be another facility of this organisation');
		}
		return this.access.findFacility(actor, body.toFacilityId, tx);
	}

	// Tech design §3: after a transfer is accepted, consent goes back to "unknown" and must be
	// re-confirmed at the new facility (unknown is treated as not consented, SPEC-009 M-02).
	private async resetConsent(tx: Transaction, actor: StaffPrincipal, residentId: Id): Promise<void> {
		const reset = {
			status: 'unknown' as const,
			source: null,
			jurisdiction: null,
			basisNote: null,
			recordedBy: actor.staffId,
			recordedAt: new Date(),
			updatedAt: new Date(),
		};
		await tx
			.insert(consents)
			.values({ organisationId: actor.organisationId, residentId, ...reset })
			.onConflictDoUpdate({ target: consents.residentId, set: reset });
	}
}
