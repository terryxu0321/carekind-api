// Global guard. Secure by default (CORE-08): every route needs a valid bearer token, and a route
// that does not declare its audience is closed to everyone. Platform and org tokens never cross.
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError, forbidden } from '../common/api-error.js';
import { AuthProvider } from './auth-provider.js';
import {
	AUDIENCE_KEY,
	type AuthenticatedRequest,
	IS_PUBLIC_KEY,
	type RouteAudience,
} from './decorators.js';

const BEARER = /^Bearer\s+(\S+)$/i;

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly authProvider: AuthProvider,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const targets = [context.getHandler(), context.getClass()];
		if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
			return true;
		}
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
		if (token === undefined) {
			throw new ApiError('unauthenticated', 'Please sign in');
		}
		const principal = await this.authProvider.authenticate(token);
		const audience = this.reflector.getAllAndOverride<RouteAudience | undefined>(
			AUDIENCE_KEY,
			targets,
		);
		if (audience === undefined || (audience !== 'any' && audience !== principal.audience)) {
			throw forbidden();
		}
		request.principal = principal;
		return true;
	}
}
