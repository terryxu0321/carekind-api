// SPEC-011 PA-03 resident register CSV import. Imported residents have no consent row, so their
// consent is "unknown" and treated as not consented (SPEC-009 M-02e).
import { Inject, Injectable } from '@nestjs/common';
import {
	type CsvImportResult,
	type Id,
	RESIDENT_CSV_COLUMNS,
	residentCsvRowSchema,
} from '@carekind/shared';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { AuditService } from '../common/audit.service.js';
import { readCsvRecords, rejectedRowsFrom } from '../common/csv.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { residents } from '../db/schema.js';
import { OrgAccessService } from './org-access.service.js';

type RejectedRow = CsvImportResult['rejectedRows'][number];

@Injectable()
export class ResidentImportService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly audit: AuditService,
	) {}

	async import(actor: StaffPrincipal, facilityId: Id, csv: unknown): Promise<CsvImportResult> {
		await this.access.facilityFor(actor, facilityId, 'manage_residents');
		const records = readCsvRecords(typeof csv === 'string' ? csv : '', RESIDENT_CSV_COLUMNS);
		const rejectedRows: RejectedRow[] = [];
		const newResidents: (typeof residents.$inferInsert)[] = [];
		for (const record of records) {
			const parsed = residentCsvRowSchema.safeParse(record.values);
			if (!parsed.success) {
				rejectedRows.push(...rejectedRowsFrom(record.rowNumber, parsed.error.issues));
				continue;
			}
			newResidents.push({
				organisationId: actor.organisationId,
				facilityId,
				givenName: parsed.data.given_name,
				preferredName: parsed.data.preferred_name,
				familyName: parsed.data.family_name,
				room: parsed.data.room,
				status: parsed.data.status,
			});
		}
		await this.db.transaction(async (tx) => {
			if (newResidents.length > 0) {
				await tx.insert(residents).values(newResidents);
			}
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'resident.import',
				entity: 'facility',
				entityId: facilityId,
				summary: `Imported ${newResidents.length} residents from CSV`,
			});
		});
		return { importedCount: newResidents.length, rejectedRows };
	}
}
