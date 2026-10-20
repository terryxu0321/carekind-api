// SPEC-011 PA-02: staff register CSV import into one facility. Valid rows are imported, invalid
// rows are reported by row number and column only (the cell may contain personal information).
import { Inject, Injectable } from '@nestjs/common';
import {
	type CsvImportResult,
	type Id,
	STAFF_CSV_COLUMNS,
	type StaffCsvRow,
	staffCsvRowSchema,
} from '@carekind/shared';
import { isNotNull, sql } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { AuditService } from '../common/audit.service.js';
import { readCsvRecords, rejectedRowsFrom } from '../common/csv.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, Transaction } from '../db/database.js';
import { staff, staffAssignments } from '../db/schema.js';
import { OrgAccessService } from './org-access.service.js';

type RejectedRow = CsvImportResult['rejectedRows'][number];

interface ValidRow {
	rowNumber: number;
	data: StaffCsvRow;
}

@Injectable()
export class StaffImportService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly audit: AuditService,
	) {}

	async import(actor: StaffPrincipal, facilityId: Id, csv: unknown): Promise<CsvImportResult> {
		await this.access.facilityFor(actor, facilityId, 'manage_staff');
		const records = readCsvRecords(typeof csv === 'string' ? csv : '', STAFF_CSV_COLUMNS);
		const rejectedRows: RejectedRow[] = [];
		const validRows: ValidRow[] = [];
		for (const record of records) {
			const parsed = staffCsvRowSchema.safeParse(record.values);
			if (parsed.success) {
				validRows.push({ rowNumber: record.rowNumber, data: parsed.data });
			} else {
				rejectedRows.push(...rejectedRowsFrom(record.rowNumber, parsed.error.issues));
			}
		}
		const importedCount = await this.db.transaction(async (tx) => {
			const accepted = await this.withoutDuplicateEmails(tx, validRows, rejectedRows);
			for (const row of accepted) {
				await this.insertRow(tx, actor.organisationId, facilityId, row.data);
			}
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'staff.import',
				entity: 'facility',
				entityId: facilityId,
				summary: `Imported ${accepted.length} staff from CSV`,
			});
			return accepted.length;
		});
		rejectedRows.sort((a, b) => a.rowNumber - b.rowNumber);
		return { importedCount, rejectedRows };
	}

	// Emails are sign-in names, unique across CareKind and within the file.
	private async withoutDuplicateEmails(
		tx: Transaction,
		rows: ValidRow[],
		rejectedRows: RejectedRow[],
	): Promise<ValidRow[]> {
		const existing = await tx
			.select({ email: sql<string>`lower(${staff.email})` })
			.from(staff)
			.where(isNotNull(staff.email));
		const taken = new Set(existing.map((row) => row.email));
		return rows.filter((row) => {
			const email = row.data.email?.toLowerCase();
			if (email === undefined) {
				return true;
			}
			if (taken.has(email)) {
				rejectedRows.push({
					rowNumber: row.rowNumber,
					column: 'email',
					message: 'Email is already registered',
				});
				return false;
			}
			taken.add(email);
			return true;
		});
	}

	private async insertRow(
		tx: Transaction,
		organisationId: Id,
		facilityId: Id,
		row: StaffCsvRow,
	): Promise<void> {
		const [created] = await tx
			.insert(staff)
			.values({
				organisationId,
				givenName: row.given_name,
				familyName: row.family_name,
				position: row.position,
				employmentType: row.employment_type,
				hasAppAccess: row.has_app_access,
				email: row.email,
			})
			.returning({ id: staff.id });
		if (created === undefined) {
			throw new Error('Staff insert returned no row');
		}
		await tx
			.insert(staffAssignments)
			.values({ organisationId, staffId: created.id, facilityId, role: row.role });
	}
}
