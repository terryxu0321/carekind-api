// SPEC-009 M-02 / M-02a / M-02b: recording-consent status per resident, with source and
// jurisdiction. Staff record a decision; "unknown" is only the absence of one (or a transfer reset).
import { Inject, Injectable } from '@nestjs/common';
import type { Consent, ConsentUpdateRequest, Id } from '@carekind/shared';
import { eq } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { conflict } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { consents } from '../db/schema.js';
import { toConsent } from './org-mappers.js';
import { ResidentAccessService } from './resident-access.service.js';

@Injectable()
export class ConsentService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly residentAccess: ResidentAccessService,
		private readonly audit: AuditService,
	) {}

	async get(actor: StaffPrincipal, residentId: Id): Promise<Consent> {
		const resident = await this.residentAccess.forAction(
			actor,
			residentId,
			'manage_consent',
			this.db,
		);
		const [row] = await this.db.select().from(consents).where(eq(consents.residentId, resident.id));
		return toConsent(resident.id, row);
	}

	// Takes effect immediately (SPEC-009 M-02d); history is kept in the audit log.
	async update(actor: StaffPrincipal, residentId: Id, body: ConsentUpdateRequest): Promise<Consent> {
		return this.db.transaction(async (tx) => {
			const resident = await this.residentAccess.forAction(
				actor,
				residentId,
				'manage_consent',
				tx,
			);
			if (resident.status === 'archived') {
				throw conflict('Archived resident records are read-only');
			}
			const now = new Date();
			const decision = {
				status: body.status,
				source: body.source,
				jurisdiction: body.jurisdiction,
				basisNote: body.basisNote ?? null,
				recordedBy: actor.staffId,
				recordedAt: now,
				updatedAt: now,
			};
			const [row] = await tx
				.insert(consents)
				.values({ organisationId: actor.organisationId, residentId: resident.id, ...decision })
				.onConflictDoUpdate({ target: consents.residentId, set: decision })
				.returning();
			// The consent status itself stays out of the summary; the row holds it (P-1).
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId: resident.facilityId,
				action: 'consent.update',
				entity: 'resident',
				entityId: resident.id,
				summary: 'Recorded a recording-consent decision',
			});
			return toConsent(resident.id, row);
		});
	}
}
