// Route metadata read by AuthGuard, and parameter decorators that hand controllers a typed principal.
import {
	type CustomDecorator,
	type ExecutionContext,
	SetMetadata,
	createParamDecorator,
} from '@nestjs/common';
import type { AuthAudience } from '@carekind/shared';
import type { Request } from 'express';
import { ApiError, forbidden } from '../common/api-error.js';
import type { PlatformPrincipal, Principal, StaffPrincipal } from './principal.js';

export const IS_PUBLIC_KEY = 'carekind:isPublic';
export const AUDIENCE_KEY = 'carekind:audience';

// "any" = any signed-in user (only GET /auth/me needs it).
export type RouteAudience = AuthAudience | 'any';

export interface AuthenticatedRequest extends Request {
	principal?: Principal;
}

export function Public(): CustomDecorator<string> {
	return SetMetadata(IS_PUBLIC_KEY, true);
}

export function Audience(audience: RouteAudience): CustomDecorator<string> {
	return SetMetadata(AUDIENCE_KEY, audience);
}

function principalOf(context: ExecutionContext): Principal {
	const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
	if (principal === undefined) {
		throw new ApiError('unauthenticated', 'Please sign in');
	}
	return principal;
}

export const CurrentPrincipal = createParamDecorator(
	(_data: unknown, context: ExecutionContext): Principal => principalOf(context),
);

export const CurrentPlatformAdmin = createParamDecorator(
	(_data: unknown, context: ExecutionContext): PlatformPrincipal => {
		const principal = principalOf(context);
		if (principal.audience !== 'platform') {
			throw forbidden();
		}
		return principal;
	},
);

export const CurrentStaff = createParamDecorator(
	(_data: unknown, context: ExecutionContext): StaffPrincipal => {
		const principal = principalOf(context);
		if (principal.audience !== 'org') {
			throw forbidden();
		}
		return principal;
	},
);
