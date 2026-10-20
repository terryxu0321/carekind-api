// Boundary validation (code-rules CORE-07, TY-3) with the zod schemas from @carekind/shared.
// Typed structurally so the API does not need its own copy of zod.
import type { PipeTransform } from '@nestjs/common';
import { idSchema } from '@carekind/shared';
import { notFound, validationFailed } from './api-error.js';

export interface SchemaIssue {
	readonly path: readonly PropertyKey[];
	readonly message: string;
}

export interface ParseableSchema<Output> {
	safeParse(
		input: unknown,
	):
		| { success: true; data: Output }
		| { success: false; error: { issues: readonly SchemaIssue[] } };
}

const MAX_MESSAGE_LENGTH = 500;

// zod messages describe the rule broken (type, length, enum), not the submitted value.
export function describeIssues(issues: readonly SchemaIssue[]): string {
	const parts = issues.map((issue) => {
		const field = issue.path.map(String).join('.');
		return field ? `${field}: ${issue.message}` : issue.message;
	});
	return parts.join('; ').slice(0, MAX_MESSAGE_LENGTH) || 'Invalid request';
}

export function parseWith<Output>(schema: ParseableSchema<Output>, input: unknown): Output {
	const result = schema.safeParse(input);
	if (!result.success) {
		throw validationFailed(describeIssues(result.error.issues));
	}
	return result.data;
}

export class SchemaPipe<Output> implements PipeTransform<unknown, Output> {
	constructor(private readonly schema: ParseableSchema<Output>) {}

	transform(value: unknown): Output {
		return parseWith(this.schema, value);
	}
}

// A malformed id cannot match any record, so it is reported as not found.
export class IdPipe implements PipeTransform<unknown, string> {
	transform(value: unknown): string {
		const result = idSchema.safeParse(value);
		if (!result.success) {
			throw notFound('Resource');
		}
		return result.data;
	}
}
