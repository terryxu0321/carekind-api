// Turns every thrown error into the shared error shape. Unknown errors are logged by type only:
// database errors embed query parameters (names, rooms), which must never reach logs (P-1).
import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	Logger,
} from '@nestjs/common';
import type { ApiErrorCode, ErrorResponse } from '@carekind/shared';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

const UNIQUE_VIOLATION = '23505';

function httpExceptionCode(status: number): ApiErrorCode {
	switch (status) {
		case 400:
		case 413:
		case 415:
			return 'validation_failed';
		case 401:
			return 'unauthenticated';
		case 403:
			return 'forbidden';
		case 404:
			return 'not_found';
		default:
			return 'internal_error';
	}
}

function postgresCode(error: unknown): string | undefined {
	const cause = error instanceof Error ? error.cause : undefined;
	if (typeof cause === 'object' && cause !== null && 'code' in cause) {
		return String(cause.code);
	}
	return undefined;
}

function toApiError(error: unknown): ApiError {
	if (error instanceof ApiError) {
		return error;
	}
	if (error instanceof HttpException) {
		const code = httpExceptionCode(error.getStatus());
		const message = code === 'internal_error' ? 'Something went wrong' : 'Request was rejected';
		return new ApiError(code, message);
	}
	// A unique index caught a duplicate (e.g. the same email) that slipped past earlier checks.
	if (postgresCode(error) === UNIQUE_VIOLATION) {
		return new ApiError('conflict', 'A record with the same unique value already exists');
	}
	return new ApiError('internal_error', 'Something went wrong');
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
	private readonly logger = new Logger('ApiExceptionFilter');

	catch(error: unknown, host: ArgumentsHost): void {
		const apiError = toApiError(error);
		if (apiError.code === 'internal_error') {
			const kind = error instanceof Error ? error.name : typeof error;
			this.logger.error(`Unhandled ${kind} (postgres code ${postgresCode(error) ?? 'none'})`);
		}
		const body: ErrorResponse = { error: { code: apiError.code, message: apiError.message } };
		host.switchToHttp().getResponse<Response>().status(apiError.status).json(body);
	}
}
