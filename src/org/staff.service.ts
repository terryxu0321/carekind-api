// SPEC-011 PA-02 / PA-02b: staff register, facility assignments and staff lifecycle (§3.2).
import { Inject, Injectable } from '@nestjs/common';
import {
	type Id,
	type InviteLinkResponse,
	type Staff,
	type StaffAssignment,
	type StaffCreateRequest,
	type StaffEvent,
	type StaffListQuery,
	type StaffUpdateRequest,
	nextStaffLifecycle,
	staffCreateRequestSchema,
} from '@carekind/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { InviteService } from '../auth/invite.service.js';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { ApiError, conflict, forbidden, validationFailed } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, DbExecutor } from '../db/database.js';
import { assignmentsByStaff } from '../db/queries.js';
import { facilities, staff, staffAssignments } from '../db/schema.js';
import { OrgAccessService } from './org-access.service.js';
import { type StaffRow, toStaff } from './org-mappers.js';
import {
	type AccessibleStaff,
	StaffAccessService,
	auditFacilityFor,
	isManaged,
} from './staff-access.service.js';

type CreateInput = ReturnType<typeof staffCreateRequestSchema.parse>;

const EMAIL_REQUIRED = 'Email is required when the staff member has app access';

@Injectable()
export class StaffService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly staffAccess: StaffAccessService,
		private readonly invites: InviteService,
		private readonly audit: AuditService,
	) {}

	async list(actor: StaffPrincipal, query: StaffListQuery): Promise<Staff[]> {
		const managed = await this.staffAccess.managedFacilityIds(actor);
		if (managed !== null && managed.length === 0) {
			throw forbidden();
		}
		let facilityIds = managed;
		if (query.facilityId !== undefined) {
			await this.access.facilityFor(actor, query.facilityId, 'manage_staff');
			facilityIds = [query.facilityId];
		}
		const rows = await this.staffInScope(actor.organisationId, facilityIds);
		const assignments = await assignmentsByStaff(
			this.db,
			rows.map((row) => row.id),
		);
		return rows.map((row) => toStaff(row, assignments.get(row.id) ?? []));
	}

	async get(actor: StaffPrincipal, staffId: Id): Promise<Staff> {
		const target = await this.staffAccess.forRead(actor, staffId, this.db);
		return toStaff(target.row, target.assignments);
	}

	async create(actor: StaffPrincipal, body: CreateInput): Promise<Staff> {
		const managed = await this.staffAccess.managedFacilityIds(actor);
		if (body.isOrgAdmin && !actor.isOrgAdmin) {
			throw forbidden();
		}
		// A facility role must place new staff in one of its own facilities, or it could not see them.
		if (managed !== null && body.assignments.length === 0) {
			throw validationFailed('Assign the staff member to at least one of your facilities');
		}
		return this.db.transaction(async (tx) => {
			await this.checkAssignableFacilities(tx, actor, body.assignments, managed);
			const [row] = await tx
				.insert(staff)
				.values({
					organisationId: actor.organisationId,
					givenName: body.givenName,
					familyName: body.familyName,
					position: body.position,
					employmentType: body.employmentType,
					isOrgAdmin: body.isOrgAdmin,
					hasAppAccess: body.hasAppAccess,
					email: body.email ?? null,
				})
				.returning();
			if (row === undefined) {
				throw new Error('Staff insert returned no row');
			}
			await this.replaceAssignments(tx, actor.organisationId, row.id, body.assignments);
			await this.record(tx, actor, row.id, auditFacilityFor(body.assignments, managed), {
				action: 'staff.create',
				summary: 'Added staff member to the register',
			});
			return toStaff(row, body.assignments);
		});
	}

	async update(actor: StaffPrincipal, staffId: Id, body: StaffUpdateRequest): Promise<Staff> {
		return this.db.transaction(async (tx) => {
			const target = await this.staffAccess.forWrite(actor, staffId, tx);
			if (body.isOrgAdmin !== undefined && !actor.isOrgAdmin) {
				throw forbidden();
			}
			const hasAppAccess = body.hasAppAccess ?? target.row.hasAppAccess;
			const email = body.email === undefined ? target.row.email : body.email;
			if (hasAppAccess && email === null) {
				throw validationFailed(EMAIL_REQUIRED);
			}
			const [row] = await tx
				.update(staff)
				.set({ ...body, updatedAt: new Date() })
				.where(eq(staff.id, staffId))
				.returning();
			await this.record(tx, actor, staffId, target.auditFacilityId, {
				action: 'staff.update',
				summary: 'Updated staff details',
			});
			return toStaff(row ?? target.row, target.assignments);
		});
	}

	// Facility roles only change assignments at their own facilities; others stay as they are.
	async updateAssignments(
		actor: StaffPrincipal,
		staffId: Id,
		requested: StaffAssignment[],
	): Promise<Staff> {
		return this.db.transaction(async (tx) => {
			const target = await this.staffAccess.forWrite(actor, staffId, tx);
			const managed = target.managedFacilityIds;
			const outside = (item: StaffAssignment): boolean => !isManaged(managed, item.facilityId);
			const keptOutside = target.assignments.filter(outside);
			const changesOutside = requested
				.filter(outside)
				.some(
					(item) =>
						!keptOutside.some(
							(kept) => kept.facilityId === item.facilityId && kept.role === item.role,
						),
				);
			if (changesOutside) {
				throw forbidden();
			}
			const finalAssignments = [...keptOutside, ...requested.filter((item) => !outside(item))];
			await this.checkAssignableFacilities(tx, actor, finalAssignments, null);
			await this.replaceAssignments(tx, actor.organisationId, staffId, finalAssignments);
			await this.record(tx, actor, staffId, target.auditFacilityId, {
				action: 'staff.assignments',
				summary: 'Changed facility assignments',
			});
			return toStaff(target.row, finalAssignments);
		});
	}

	async invite(actor: StaffPrincipal, staffId: Id): Promise<InviteLinkResponse> {
		return this.db.transaction(async (tx) => {
			const target = await this.staffAccess.forWrite(actor, staffId, tx);
			const link = await this.invites.invite(tx, target.row);
			await this.record(tx, actor, staffId, target.auditFacilityId, {
				action: 'staff.invite',
				summary: 'Issued an invite link',
			});
			return link;
		});
	}

	completeTraining(actor: StaffPrincipal, staffId: Id): Promise<Staff> {
		return this.transition(actor, staffId, 'complete_training', 'Confirmed CareKind training');
	}

	// SPEC-011 §3.2: deactivation takes effect at once; the guard re-checks lifecycle on every request.
	deactivate(actor: StaffPrincipal, staffId: Id): Promise<Staff> {
		if (staffId === actor.staffId) {
			throw conflict('You cannot deactivate your own account');
		}
		return this.transition(actor, staffId, 'deactivate', 'Deactivated staff member');
	}

	private async transition(
		actor: StaffPrincipal,
		staffId: Id,
		event: StaffEvent,
		summary: string,
	): Promise<Staff> {
		return this.db.transaction(async (tx) => {
			const target: AccessibleStaff = await this.staffAccess.forWrite(actor, staffId, tx);
			const next = nextStaffLifecycle(target.row.lifecycle, event);
			if (!next.ok) {
				throw new ApiError('invalid_transition', next.reason);
			}
			const now = new Date();
			const trainingCompletedAt =
				event === 'complete_training' ? now : target.row.trainingCompletedAt;
			const [row] = await tx
				.update(staff)
				.set({ lifecycle: next.value, trainingCompletedAt, updatedAt: now })
				.where(eq(staff.id, staffId))
				.returning();
			await this.record(tx, actor, staffId, target.auditFacilityId, {
				action: `staff.${event}`,
				summary,
			});
			return toStaff(row ?? target.row, target.assignments);
		});
	}

	private async staffInScope(organisationId: Id, facilityIds: Id[] | null): Promise<StaffRow[]> {
		const inOrganisation = eq(staff.organisationId, organisationId);
		const order = [asc(staff.familyName), asc(staff.givenName)];
		if (facilityIds === null) {
			return this.db.select().from(staff).where(inOrganisation).orderBy(...order);
		}
		const assigned = this.db
			.select({ staffId: staffAssignments.staffId })
			.from(staffAssignments)
			.where(inArray(staffAssignments.facilityId, facilityIds));
		return this.db
			.select()
			.from(staff)
			.where(and(inOrganisation, inArray(staff.id, assigned)))
			.orderBy(...order);
	}

	// Every facility must belong to the caller's organisation, and (for facility roles) be theirs.
	private async checkAssignableFacilities(
		executor: DbExecutor,
		actor: StaffPrincipal,
		assignments: readonly StaffAssignment[],
		managed: Id[] | null,
	): Promise<void> {
		if (assignments.some((item) => !isManaged(managed, item.facilityId))) {
			throw forbidden();
		}
		const facilityIds = assignments.map((item) => item.facilityId);
		if (facilityIds.length === 0) {
			return;
		}
		const found = await executor
			.select({ id: facilities.id })
			.from(facilities)
			.where(
				and(
					inArray(facilities.id, facilityIds),
					eq(facilities.organisationId, actor.organisationId),
				),
			);
		if (found.length !== new Set(facilityIds).size) {
			throw validationFailed('Every assignment must name a facility of this organisation');
		}
	}

	private async replaceAssignments(
		executor: DbExecutor,
		organisationId: Id,
		staffId: Id,
		assignments: readonly StaffAssignment[],
	): Promise<void> {
		await executor.delete(staffAssignments).where(eq(staffAssignments.staffId, staffId));
		if (assignments.length > 0) {
			await executor
				.insert(staffAssignments)
				.values(assignments.map((item) => ({ ...item, organisationId, staffId })));
		}
	}

	private async record(
		executor: DbExecutor,
		actor: StaffPrincipal,
		staffId: Id,
		facilityId: Id | null,
		entry: { action: string; summary: string },
	): Promise<void> {
		await this.audit.append(executor, {
			actor: auditActorOf(actor),
			organisationId: actor.organisationId,
			facilityId,
			action: entry.action,
			entity: 'staff',
			entityId: staffId,
			summary: entry.summary,
		});
	}
}
