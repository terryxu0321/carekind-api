import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
	type AcceptInviteRequest,
	type LoginRequest,
	type LoginResponse,
	type MeResponse,
	ROUTES,
	acceptInviteRequestSchema,
	loginRequestSchema,
} from '@carekind/shared';
import { SchemaPipe } from '../common/schema.pipe.js';
import { AuthProvider } from './auth-provider.js';
import { Audience, CurrentPrincipal, Public } from './decorators.js';
import type { Principal } from './principal.js';

const OK = 200;

@Controller()
export class AuthController {
	constructor(private readonly authProvider: AuthProvider) {}

	@Public()
	@Post(ROUTES.auth.login)
	@HttpCode(OK)
	login(@Body(new SchemaPipe(loginRequestSchema)) body: LoginRequest): Promise<LoginResponse> {
		return this.authProvider.login(body);
	}

	@Public()
	@Post(ROUTES.auth.acceptInvite)
	@HttpCode(OK)
	acceptInvite(
		@Body(new SchemaPipe(acceptInviteRequestSchema)) body: AcceptInviteRequest,
	): Promise<LoginResponse> {
		return this.authProvider.acceptInvite(body);
	}

	@Audience('any')
	@Get(ROUTES.auth.me)
	me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
		return this.authProvider.describe(principal);
	}
}
