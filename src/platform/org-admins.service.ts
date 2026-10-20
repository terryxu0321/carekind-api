// SPEC-010 SA-03: the platform invites, re-invites and deactivates organisation admins.
// It is the only staff detail the platform may see (SA-05).
import { Inject, Injectable } from '@nestjs/common';
import {
	type AdminInviteRequest,
	type Id,
	type InviteLinkResponse,
	type OrgAdminSummary,
	nextStaffLifecycle,
} from '@carekind/shared';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { InviteService } from '../auth/invite.service.js';
import { type PlatformPrincipal, auditActorOf } from '../auth/principal.js';
import { ApiError, conflict, notFound } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, Transaction } from '../db/database.js';
import { staff } from '../db/schema.js';
import { requireOrganisation } from './organisations.service.js';
import { toOrgAdminSummary } from './platform-mappers.js';

type StaffRow = typeof staff.$inferSelect;

// The org admin edits these in the admin console later (PA-02); the platform only knows the name.
const ORG_ADMIN_POSITION = 'Organisation administrator';
const ORG_ADMIN_EMPLOYMENT = 'full_time';

function withEmail(row: StaffRow): StaffRow & { email: string } {
	if (row.email === null) {
		throw notFound('Organisation admin');
	}
	return { ...row, email: row.email };
}

@Injectable()
export class OrgAdminsService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly audit: AuditService,
		private readonly invites: InviteService,
	) {}

	async list(organisationId: Id): Promise<OrgAdminSummary[]> {
		await requireOrganisation(this.db, organisationId);
		const rows = await this.db
			.select()
			.from(staff)
			.where(
				and(
					eq(staff.organisationId, organisationId),
					eq(staff.isOrgAdmin, true),
					isNotNull(staff.email),
				),
			)
			.orderBy(asc(staff.familyName), asc(staff.givenName));
		return rows.map((row) => toOrgAdminSummary(withEmail(row)));
	}

	async invite(
		actor: PlatformPrincipal,
		organisationId: Id,
		body: AdminInviteRequest,
	): Promise<InviteLinkResponse> {
		return this.db.transaction(async (tx) => {
			await requireOrganisation(tx, organisationId);
			const admin = await this.findOrCreateAdmin(tx, organisationId, body);
			const link = await this.invites.invite(tx, admin);
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId,
				action: 'org_admin.invite',
				entity: 'staff',
				entityId: admin.id,
				summary: 'Issued an organisation admin invite link',
			});
			return link;
		});
	}

	async deactivate(actor: PlatformPrincipal, staffId: Id): Promise<OrgAdminSummary> {
		return this.db.transaction(async (tx) => {
			const [admin] = await tx
				.select()
				.from(staff)
				.where(and(eq(staff.id, staffId), eq(staff.isOrgAdmin, true)));
			if (admin === undefined) {
				throw notFound('Organisation admin');
			}
			const next = nextStaffLifecycle(admin.lifecycle, 'deactivate');
			if (!next.ok) {
				throw new ApiError('invalid_transition', next.reason);
			}
			const [updated] = await tx
				.update(staff)
				.set({ lifecycle: next.value, updatedAt: new Date() })
				.where(eq(staff.id, staffId))
				.returning();
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: admin.organisationId,
				action: 'org_admin.deactivate',
				entity: 'staff',
				entityId: admin.id,
				summary: 'Deactivated an organisation admin',
			});
			return toOrgAdminSummary(withEmail(updated ?? admin));
		});
	}

	// Re-inviting an existing admin of this organisation re-issues the link (SA-03 "重发邀请").
	private async findOrCreateAdmin(
		tx: Transaction,
		organisationId: Id,
		body: AdminInviteRequest,
	): Promise<StaffRow> {
		const [existing] = await tx
			.select()
			.from(staff)
			.where(sql`lower(${staff.email}) = lower(${body.email})`);
		if (existing !== undefined) {
			if (existing.organisationId !== organisationId || !existing.isOrgAdmin) {
				throw conflict('This email is already registered');
			}
			return existing;
		}
		const [created] = await tx
			.insert(staff)
			.values({
				organisationId,
				givenName: body.givenName,
				familyName: body.familyName,
				email: body.email,
				position: ORG_ADMIN_POSITION,
				employmentType: ORG_ADMIN_EMPLOYMENT,
				isOrgAdmin: true,
				hasAppAccess: false,
			})
			.returning();
		if (created === undefined) {
			throw new Error('Staff insert returned no row');
		}
		return created;
	}
}
