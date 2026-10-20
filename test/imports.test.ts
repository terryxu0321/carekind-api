// SPEC-011 PA-02 / PA-03 register CSV imports, plus the CSV reader itself. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BYTE_ORDER_MARK, readCsvRecords } from '../src/common/csv.js';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

describe('readCsvRecords', () => {
	it('should_read_quoted_fields_crlf_and_bom', () => {
		const text = `${BYTE_ORDER_MARK}given_name,family_name\r\n"Ann, Jr",Sample\r\n"Say ""hi""",Example\r\n\r\n`;
		expect(readCsvRecords(text, ['given_name', 'family_name'])).toEqual([
			{ rowNumber: 2, values: { given_name: 'Ann, Jr', family_name: 'Sample' } },
			{ rowNumber: 3, values: { given_name: 'Say "hi"', family_name: 'Example' } },
		]);
	});

	it('should_reject_missing_columns_and_unclosed_quotes', () => {
		expect(() => readCsvRecords('given_name\nA', ['given_name', 'family_name'])).toThrow(
			/missing columns: family_name/,
		);
		expect(() => readCsvRecords('given_name\n"A', ['given_name'])).toThrow(/unclosed/);
	});
});

let api: TestApi;
let orgA: TestApi['seed']['organisations']['orgA'];
let admin: ReturnType<TestApi['client']>;

beforeAll(async () => {
	api = await startTestApi();
	orgA = api.seed.organisations.orgA;
	admin = api.client(await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'));
});

afterAll(async () => {
	await api.close();
});

describe('register imports', () => {
	it('should_import_valid_staff_rows_and_report_bad_rows_without_content', async () => {
		const vic = requireKey(orgA.facilityIds, 'vic');
		const csv = [
			'given_name,family_name,position,employment_type,role,has_app_access,email',
			'Synthetic,Importone,PCW,casual,pcw,yes,org-a.import1@example.com',
			'Synthetic,Importtwo,Cook,part_time,no_app,no,',
			'Synthetic,Badrow,PCW,sometimes,pcw,yes,',
			'Synthetic,Dupe,RN,full_time,rn,yes,org-a.rn1@example.com',
		].join('\n');
		const result = await admin.org.importStaff(vic, csv);
		expect(result.importedCount).toBe(2);
		const rejectedRows = result.rejectedRows.map((row) => row.rowNumber);
		expect(rejectedRows).toEqual(expect.arrayContaining([4, 5]));
		expect(JSON.stringify(result.rejectedRows)).not.toMatch(/Badrow|Dupe|sometimes/);
		const staff = await admin.org.listStaff({ facilityId: vic });
		expect(staff.some((member) => member.familyName === 'Importone')).toBe(true);
	});

	it('should_import_residents_with_unknown_consent', async () => {
		const nsw2 = requireKey(orgA.facilityIds, 'nsw2');
		const csv = [
			'given_name,preferred_name,family_name,room,status',
			'Synthetic,,Residentone,B1,',
			'Synthetic,Syn,Residenttwo,,pre_admission',
			',,Missinggiven,B3,',
		].join('\n');
		const result = await admin.org.importResidents(nsw2, csv);
		expect(result.importedCount).toBe(2);
		expect(result.rejectedRows).toEqual([
			expect.objectContaining({ rowNumber: 4, column: 'given_name' }),
		]);
		const residents = await admin.org.listResidents(nsw2);
		const imported = residents.find((resident) => resident.familyName === 'Residentone');
		expect(imported?.status).toBe('in_residence');
		expect((await admin.org.getConsent(imported?.id ?? '')).status).toBe('unknown');
	});

	it('should_refuse_imports_into_facilities_without_permission', async () => {
		const don = api.client(await api.login(requireKey(orgA.emails, 'don'), 'org'));
		await expectApiError(
			don.org.importStaff(requireKey(orgA.facilityIds, 'nsw1'), 'given_name\n'),
			'forbidden',
		);
	});
});
