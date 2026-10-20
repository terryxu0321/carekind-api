// Tech design §1: authentication sits behind this boundary so a managed identity service can
// replace the local password + JWT implementation without touching controllers (SOLID D).
import type { AcceptInviteRequest, LoginRequest, LoginResponse, MeResponse } from '@carekind/shared';
import type { Principal } from './principal.js';

export abstract class AuthProvider {
	abstract login(request: LoginRequest): Promise<LoginResponse>;
	abstract acceptInvite(request: AcceptInviteRequest): Promise<LoginResponse>;
	// Throws unauthenticated / organisation_suspended when the token no longer grants access.
	abstract authenticate(bearerToken: string): Promise<Principal>;
	abstract describe(principal: Principal): Promise<MeResponse>;
}
