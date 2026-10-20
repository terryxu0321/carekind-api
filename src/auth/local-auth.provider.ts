// M0 implementation of AuthProvider: email + password, JWT bearer sessions (tech design §1, §4).
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
	type AcceptInviteRequest,
	type AuthAudience,
	type LoginRequest,
	type LoginResponse,
	type MeResponse,
	canSignInToAdminConsole,
	idSchema,
	nextStaffLifecycle,
} from '@carekind/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { toIso } from '../common/dates.js';
import { DATABASE } from '../common/tokens.js';
import type { Database } from '../db/database.js';
import { assignmentsOf, findOrganisation } from '../db/queries.js';
import { invites, platformAdmins, staff } from '../db/schema.js';
import { AuthProvider } from './auth-provider.js';
import { hashInviteToken } from './invite.service.js';
import { hashPassword, verifyAgainstDecoy, verifyPassword } from './password.js';
import type { PlatformPrincipal, Principal, StaffPrincipal } from './principal.js';

// An admin working day; there is no refresh token in M0, so the user signs in again after this.
const SESSION_HOURS = 8;
const MS_PER_HOUR = 60 * 60 * 1000;

interface SessionClaims {
	sub: string;
	audience: AuthAudience;
}

// One message for unknown email, wrong password and inactive account: no account enumeration.
function invalidCredentials(): ApiError {
	return new ApiError('unauthenticated', 'Email or password is incorrect');
}

function sessionExpired(): ApiError {
	return new ApiError('unauthenticated', 'Please sign in again');
}

function organisationSuspended(): ApiError {
	return new ApiError('organisation_suspended', 'This organisation is suspended');
}

function inviteInvalid(): ApiError {
	return new ApiError('invite_invalid', 'This invite link is invalid or has expired');
}

@Injectable()
export class LocalAuthProvider extends AuthProvider {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly jwt: JwtService,
		private readonly audit: AuditService,
	) {
		super();
	}

	async login(request: LoginRequest): Promise<LoginResponse> {
		const principal =
			request.audience === 'platform'
				? await this.checkPlatformLogin(request.email, request.password)
				: await this.checkStaffLogin(request.email, request.password);
		return this.issueSession(principal);
	}

	async acceptInvite(request: AcceptInviteRequest): Promise<LoginResponse> {
		// Hash before the transaction: scrypt is slow and must not hold the database lock.
		const passwordHash = await hashPassword(request.newPassword);
		const staffId = await this.db.transaction(async (tx) => {
			const [invite] = await tx
				.select()
				.from(invites)
				.where(
					and(eq(invites.tokenHash, hashInviteToken(request.token)), isNull(invites.usedAt)),
				);
			if (invite === undefined || invite.expiresAt.getTime() < Date.now()) {
				throw inviteInvalid();
			}
			const [member] = await tx.select().from(staff).where(eq(staff.id, invite.staffId));
			const organisation = await findOrganisation(tx, invite.organisationId);
			if (member === undefined || organisation === undefined) {
				throw inviteInvalid();
			}
			if (organisation.status !== 'active') {
				throw organisationSuspended();
			}
			const next = nextStaffLifecycle(member.lifecycle, 'accept_invite');
			if (!next.ok) {
				throw inviteInvalid();
			}
			const now = new Date();
			await tx
				.update(staff)
				.set({ passwordHash, lifecycle: next.value, lastLoginAt: now, updatedAt: now })
				.where(eq(staff.id, member.id));
			await tx
				.update(invites)
				.set({ usedAt: now, updatedAt: now })
				.where(eq(invites.id, invite.id));
			await this.audit.append(tx, {
				actor: { actorType: 'staff', actorId: member.id },
				organisationId: member.organisationId,
				action: 'staff.accept_invite',
				entity: 'staff',
				entityId: member.id,
				summary: 'Accepted invite and set a password',
			});
			return member.id;
		});
		return this.issueSession(await this.loadStaffPrincipal(staffId));
	}

	async authenticate(bearerToken: string): Promise<Principal> {
		const claims = await this.verifyToken(bearerToken);
		return claims.audience === 'platform'
			? this.loadPlatformPrincipal(claims.sub)
			: this.loadStaffPrincipal(claims.sub);
	}

	async describe(principal: Principal): Promise<MeResponse> {
		if (principal.audience === 'platform') {
			const [admin] = await this.db
				.select()
				.from(platformAdmins)
				.where(eq(platformAdmins.id, principal.adminId));
			if (admin === undefined) {
				throw sessionExpired();
			}
			return { audience: 'platform', id: admin.id, name: admin.name, email: admin.email };
		}
		const [member] = await this.db.select().from(staff).where(eq(staff.id, principal.staffId));
		const organisation = await findOrganisation(this.db, principal.organisationId);
		if (member === undefined || member.email === null || organisation === undefined) {
			throw sessionExpired();
		}
		return {
			audience: 'org',
			staffId: member.id,
			organisationId: organisation.id,
			organisationName: organisation.name,
			givenName: member.givenName,
			familyName: member.familyName,
			email: member.email,
			isOrgAdmin: member.isOrgAdmin,
			assignments: principal.assignments,
		};
	}

	private async checkPlatformLogin(email: string, password: string): Promise<PlatformPrincipal> {
		const [admin] = await this.db
			.select()
			.from(platformAdmins)
			.where(sql`lower(${platformAdmins.email}) = lower(${email})`);
		const isValid =
			admin === undefined
				? await verifyAgainstDecoy(password)
				: await verifyPassword(password, admin.passwordHash);
		if (admin === undefined || !isValid || !admin.isActive) {
			throw invalidCredentials();
		}
		return { audience: 'platform', adminId: admin.id };
	}

	private async checkStaffLogin(email: string, password: string): Promise<StaffPrincipal> {
		const [member] = await this.db
			.select()
			.from(staff)
			.where(sql`lower(${staff.email}) = lower(${email})`);
		const isValid =
			member?.passwordHash == null
				? await verifyAgainstDecoy(password)
				: await verifyPassword(password, member.passwordHash);
		if (member === undefined || !isValid || !canSignInToAdminConsole(member.lifecycle)) {
			throw invalidCredentials();
		}
		const principal = await this.loadStaffPrincipal(member.id);
		await this.db.update(staff).set({ lastLoginAt: new Date() }).where(eq(staff.id, member.id));
		return principal;
	}

	private async verifyToken(bearerToken: string): Promise<SessionClaims> {
		let claims: unknown;
		try {
			claims = await this.jwt.verifyAsync(bearerToken, { algorithms: ['HS256'] });
		} catch {
			throw sessionExpired();
		}
		if (typeof claims !== 'object' || claims === null) {
			throw sessionExpired();
		}
		const { sub, audience } = claims as Partial<SessionClaims>;
		if (!idSchema.safeParse(sub).success || (audience !== 'platform' && audience !== 'org')) {
			throw sessionExpired();
		}
		return { sub: String(sub), audience };
	}

	private async loadPlatformPrincipal(adminId: string): Promise<PlatformPrincipal> {
		const [admin] = await this.db
			.select({ isActive: platformAdmins.isActive })
			.from(platformAdmins)
			.where(eq(platformAdmins.id, adminId));
		if (admin === undefined || !admin.isActive) {
			throw sessionExpired();
		}
		return { audience: 'platform', adminId };
	}

	// Checked on every request: a deactivated member or suspended organisation loses access at once.
	private async loadStaffPrincipal(staffId: string): Promise<StaffPrincipal> {
		const [member] = await this.db.select().from(staff).where(eq(staff.id, staffId));
		if (member === undefined || !canSignInToAdminConsole(member.lifecycle)) {
			throw sessionExpired();
		}
		const organisation = await findOrganisation(this.db, member.organisationId);
		if (organisation === undefined || organisation.status !== 'active') {
			throw organisationSuspended();
		}
		return {
			audience: 'org',
			staffId: member.id,
			organisationId: member.organisationId,
			isOrgAdmin: member.isOrgAdmin,
			assignments: await assignmentsOf(this.db, member.id),
		};
	}

	private async issueSession(principal: Principal): Promise<LoginResponse> {
		const claims: SessionClaims =
			principal.audience === 'platform'
				? { sub: principal.adminId, audience: 'platform' }
				: { sub: principal.staffId, audience: 'org' };
		const expiresAt = new Date(Date.now() + SESSION_HOURS * MS_PER_HOUR);
		const accessToken = await this.jwt.signAsync(claims, {
			algorithm: 'HS256',
			expiresIn: SESSION_HOURS * 60 * 60,
		});
		return { accessToken, expiresAt: toIso(expiresAt), me: await this.describe(principal) };
	}
}
