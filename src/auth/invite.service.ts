// Invites are never emailed (AGENTS hard rule 3): we create a one-time link that the inviter
// copies. Only a SHA-256 hash of the token is stored, so a database leak cannot be replayed.
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
	INVITE_VALID_DAYS,
	type Id,
	type InviteLinkResponse,
	type StaffLifecycle,
	nextStaffLifecycle,
} from '@carekind/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ApiError, validationFailed } from '../common/api-error.js';
import { toIso } from '../common/dates.js';
import { APP_CONFIG } from '../common/tokens.js';
import type { AppConfig } from '../config/app-config.js';
import type { DbExecutor } from '../db/database.js';
import { invites, staff } from '../db/schema.js';

const TOKEN_BYTES = 32;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function hashInviteToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export interface InvitableStaff {
	id: Id;
	organisationId: Id;
	lifecycle: StaffLifecycle;
	email: string | null;
}

@Injectable()
export class InviteService {
	constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

	// Moves the staff member to "invited" (SPEC-011 §3.2) and returns a fresh link. Re-inviting
	// (SA-03 "重发邀请") retires any earlier unused link so only the newest one works.
	async invite(executor: DbExecutor, member: InvitableStaff): Promise<InviteLinkResponse> {
		if (member.email === null) {
			throw validationFailed('Add an email address before sending an invite');
		}
		const next = nextStaffLifecycle(member.lifecycle, 'invite');
		if (!next.ok) {
			throw new ApiError('invalid_transition', next.reason);
		}
		const now = new Date();
		await executor
			.update(staff)
			.set({ lifecycle: next.value, updatedAt: now })
			.where(eq(staff.id, member.id));
		await executor
			.update(invites)
			.set({ usedAt: now, updatedAt: now })
			.where(and(eq(invites.staffId, member.id), isNull(invites.usedAt)));
		const token = randomBytes(TOKEN_BYTES).toString('base64url');
		const expiresAt = new Date(now.getTime() + INVITE_VALID_DAYS * MS_PER_DAY);
		await executor.insert(invites).values({
			organisationId: member.organisationId,
			staffId: member.id,
			tokenHash: hashInviteToken(token),
			expiresAt,
		});
		const inviteUrl = new URL('/accept-invite', this.config.adminWebUrl);
		inviteUrl.searchParams.set('token', token);
		return { staffId: member.id, inviteUrl: inviteUrl.toString(), expiresAt: toIso(expiresAt) };
	}
}
