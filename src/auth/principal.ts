// Who is calling, rebuilt from the database on every request so that deactivation, suspension
// and assignment changes apply at once (SPEC-011 §3.2: "停用立即生效").
import type { Id, StaffAccess, StaffAssignment } from '@carekind/shared';

export interface PlatformPrincipal {
	audience: 'platform';
	adminId: Id;
}

// organisationId and assignments come from the database, never from the request (SA-01a).
export interface StaffPrincipal extends StaffAccess {
	audience: 'org';
	staffId: Id;
	organisationId: Id;
	isOrgAdmin: boolean;
	assignments: StaffAssignment[];
}

export type Principal = PlatformPrincipal | StaffPrincipal;

export interface AuditActor {
	actorType: 'platform_admin' | 'staff';
	actorId: Id;
}

export function auditActorOf(principal: Principal): AuditActor {
	return principal.audience === 'platform'
		? { actorType: 'platform_admin', actorId: principal.adminId }
		: { actorType: 'staff', actorId: principal.staffId };
}
