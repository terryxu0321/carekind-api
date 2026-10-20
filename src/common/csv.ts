// Minimal RFC 4180 CSV reader for register imports (PA-02, PA-03). Written here instead of adding
// a dependency (CORE-11): imports are small, comma-separated, with optional double-quoted fields.
import type { CsvImportResult } from '@carekind/shared';
import { validationFailed } from './api-error.js';
import type { SchemaIssue } from './schema.pipe.js';

export interface CsvRecord {
	// Spreadsheet row number: the header is row 1, the first data row is row 2.
	rowNumber: number;
	values: Record<string, string>;
}

type RejectedRow = CsvImportResult['rejectedRows'][number];

const MAX_IMPORT_ROWS = 2000;

function parseRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	const input = text.replace(/^﻿/, '');
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		if (inQuotes) {
			if (char === '"' && input[index + 1] === '"') {
				field += '"';
				index += 1;
			} else if (char === '"') {
				inQuotes = false;
			} else {
				field += char;
			}
			continue;
		}
		if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && input[index + 1] === '\n') {
				index += 1;
			}
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += char;
		}
	}
	if (inQuotes) {
		throw validationFailed('CSV has an unclosed quoted field');
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

function isBlank(row: string[]): boolean {
	return row.every((cell) => cell.trim() === '');
}

// Returns one record per non-blank data row, keyed by the header names.
export function readCsvRecords(text: string, requiredColumns: readonly string[]): CsvRecord[] {
	const [header, ...dataRows] = parseRows(text);
	if (header === undefined) {
		throw validationFailed('CSV is empty');
	}
	const columns = header.map((name) => name.trim().toLowerCase());
	const missing = requiredColumns.filter((name) => !columns.includes(name));
	if (missing.length > 0) {
		throw validationFailed(`CSV is missing columns: ${missing.join(', ')}`);
	}
	if (dataRows.length > MAX_IMPORT_ROWS) {
		throw validationFailed(`CSV has more than ${MAX_IMPORT_ROWS} rows; split the file`);
	}
	const records: CsvRecord[] = [];
	dataRows.forEach((cells, index) => {
		if (isBlank(cells)) {
			return;
		}
		const values: Record<string, string> = {};
		columns.forEach((name, column) => {
			values[name] = cells[column] ?? '';
		});
		records.push({ rowNumber: index + 2, values });
	});
	return records;
}

// Rejections name the column and the rule, never the cell content (it may be a resident's name).
export function rejectedRowsFrom(rowNumber: number, issues: readonly SchemaIssue[]): RejectedRow[] {
	return issues.map((issue) => ({
		rowNumber,
		column: issue.path.length > 0 ? String(issue.path[0]) : null,
		message: issue.message.slice(0, 200) || 'Invalid value',
	}));
}
