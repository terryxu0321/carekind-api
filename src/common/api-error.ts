// Tech design §4: every error is { error: { code, message } }. Messages are written by us and
// never echo request data, so they cannot carry health information (code-rules P-1).
import type { ApiErrorCode } from '@carekind/shared';

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
	validation_failed: 400,
	unauthenticated: 401,
	forbidden: 403,
	organisation_suspended: 403,
	not_found: 404,
	conflict: 409,
	invalid_transition: 409,
	go_live_incomplete: 409,
	limit_exceeded: 422,
	invite_invalid: 400,
	internal_error: 500,
};

export class ApiError extends Error {
	readonly code: ApiErrorCode;
	readonly status: number;

	constructor(code: ApiErrorCode, message: string) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = STATUS_BY_CODE[code];
	}
}

export function notFound(entity: string): ApiError {
	return new ApiError('not_found', `${entity} not found`);
}

export function forbidden(): ApiError {
	return new ApiError('forbidden', 'You do not have permission to do this');
}

export function validationFailed(message: string): ApiError {
	return new ApiError('validation_failed', message);
}

export function conflict(message: string): ApiError {
	return new ApiError('conflict', message);
}
