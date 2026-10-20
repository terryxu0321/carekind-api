// SPEC-011 PA-04: per-facility review and escalation workflow, within the organisation's limits (SA-02).
import { Inject, Injectable } from '@nestjs/common';
import {
	type Id,
	type WorkflowSettings,
	type WorkflowSettingsBody,
	workflowWithinLimits,
} from '@carekind/shared';
import { and, eq, ne } from 'drizzle-orm';
import { type StaffPrincipal, auditActorOf } from '../auth/principal.js';
import { ApiError, notFound, validationFailed } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { DATABASE } from '../common/tokens.js';
import type { Database, DbExecutor } from '../db/database.js';
import { findOrganisation } from '../db/queries.js';
import { staff, workflowSettings } from '../db/schema.js';
import { toLimits } from '../platform/platform-mappers.js';
import { OrgAccessService } from './org-access.service.js';
import { toWorkflowSettings } from './org-mappers.js';

@Injectable()
export class WorkflowService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		private readonly access: OrgAccessService,
		private readonly audit: AuditService,
	) {}

	async get(actor: StaffPrincipal, facilityId: Id): Promise<WorkflowSettings> {
		await this.access.facilityFor(actor, facilityId, 'configure_workflow');
		const [row] = await this.db
			.select()
			.from(workflowSettings)
			.where(eq(workflowSettings.facilityId, facilityId));
		if (row === undefined) {
			throw notFound('Workflow settings');
		}
		return toWorkflowSettings(row);
	}

	async update(
		actor: StaffPrincipal,
		facilityId: Id,
		body: WorkflowSettingsBody,
	): Promise<WorkflowSettings> {
		return this.db.transaction(async (tx) => {
			await this.access.facilityFor(actor, facilityId, 'configure_workflow', tx);
			await this.checkWithinLimits(tx, actor.organisationId, body);
			if (body.transferOwnerStaffId !== null) {
				await this.checkTransferOwner(tx, actor.organisationId, body.transferOwnerStaffId);
			}
			const [row] = await tx
				.update(workflowSettings)
				.set({ ...body, updatedAt: new Date() })
				.where(eq(workflowSettings.facilityId, facilityId))
				.returning();
			if (row === undefined) {
				throw notFound('Workflow settings');
			}
			await this.audit.append(tx, {
				actor: auditActorOf(actor),
				organisationId: actor.organisationId,
				facilityId,
				action: 'workflow.update',
				entity: 'workflow_settings',
				entityId: row.id,
				summary: 'Updated review and escalation workflow',
			});
			return toWorkflowSettings(row);
		});
	}

	private async checkWithinLimits(
		executor: DbExecutor,
		organisationId: Id,
		body: WorkflowSettingsBody,
	): Promise<void> {
		const organisation = await findOrganisation(executor, organisationId);
		if (organisation === undefined) {
			throw notFound('Organisation');
		}
		const violations = workflowWithinLimits(body, toLimits(organisation));
		if (violations.length > 0) {
			throw new ApiError(
				'limit_exceeded',
				violations.map((violation) => violation.message).join('; '),
			);
		}
	}

	private async checkTransferOwner(
		executor: DbExecutor,
		organisationId: Id,
		staffId: Id,
	): Promise<void> {
		const [owner] = await executor
			.select({ id: staff.id })
			.from(staff)
			.where(
				and(
					eq(staff.id, staffId),
					eq(staff.organisationId, organisationId),
					ne(staff.lifecycle, 'deactivated'),
				),
			);
		if (owner === undefined) {
			throw validationFailed('transferOwnerStaffId must be a current staff member');
		}
	}
}
