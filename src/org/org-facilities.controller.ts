// SPEC-011 overview, facilities, go-live, workflow settings and audit (staff tokens only).
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
	type AuditEntry,
	type Facility,
	type FacilityCreateRequest,
	type FacilityOverview,
	type FacilityUpdateRequest,
	type GoLiveItemKey,
	type GoLiveItemUpdateRequest,
	type GoLiveStatus,
	ROUTES,
	type WorkflowSettings,
	type WorkflowSettingsBody,
	facilityCreateRequestSchema,
	facilityUpdateRequestSchema,
	goLiveItemKeySchema,
	goLiveItemUpdateRequestSchema,
	workflowSettingsUpdateRequestSchema,
} from '@carekind/shared';
import { Audience, CurrentStaff } from '../auth/decorators.js';
import type { StaffPrincipal } from '../auth/principal.js';
import { forbidden } from '../common/api-error.js';
import { AuditService } from '../common/audit.service.js';
import { IdPipe, SchemaPipe } from '../common/schema.pipe.js';
import { FacilitiesService } from './facilities.service.js';
import { GoLiveService } from './go-live.service.js';
import { OrgAccessService } from './org-access.service.js';
import { OverviewService } from './overview.service.js';
import { WorkflowService } from './workflow.service.js';

const OK = 200;
const routes = ROUTES.org;

@Audience('org')
@Controller()
export class OrgFacilitiesController {
	constructor(
		private readonly overviewService: OverviewService,
		private readonly facilities: FacilitiesService,
		private readonly goLive: GoLiveService,
		private readonly workflow: WorkflowService,
		private readonly access: OrgAccessService,
		private readonly audit: AuditService,
	) {}

	@Get(routes.overview)
	overview(@CurrentStaff() actor: StaffPrincipal): Promise<FacilityOverview[]> {
		return this.overviewService.overview(actor);
	}

	@Get(routes.facilities)
	listFacilities(@CurrentStaff() actor: StaffPrincipal): Promise<Facility[]> {
		return this.facilities.list(actor);
	}

	@Post(routes.facilities)
	createFacility(
		@CurrentStaff() actor: StaffPrincipal,
		@Body(new SchemaPipe(facilityCreateRequestSchema)) body: FacilityCreateRequest,
	): Promise<Facility> {
		return this.facilities.create(actor, body);
	}

	@Get(routes.facility)
	getFacility(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Facility> {
		return this.facilities.get(actor, id);
	}

	@Patch(routes.facility)
	updateFacility(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(facilityUpdateRequestSchema)) body: FacilityUpdateRequest,
	): Promise<Facility> {
		return this.facilities.update(actor, id, body);
	}

	@Get(routes.goLive)
	getGoLive(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<GoLiveStatus> {
		return this.goLive.status(actor, id);
	}

	@Patch(routes.goLiveItem)
	updateGoLiveItem(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Param('key', new SchemaPipe(goLiveItemKeySchema)) key: GoLiveItemKey,
		@Body(new SchemaPipe(goLiveItemUpdateRequestSchema)) body: GoLiveItemUpdateRequest,
	): Promise<GoLiveStatus> {
		return this.goLive.updateItem(actor, id, key, body);
	}

	@Post(routes.goLiveActivate)
	@HttpCode(OK)
	activate(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Facility> {
		return this.goLive.activate(actor, id);
	}

	@Get(routes.workflowSettings)
	getWorkflowSettings(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<WorkflowSettings> {
		return this.workflow.get(actor, id);
	}

	@Put(routes.workflowSettings)
	updateWorkflowSettings(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(workflowSettingsUpdateRequestSchema)) body: WorkflowSettingsBody,
	): Promise<WorkflowSettings> {
		return this.workflow.update(actor, id, body);
	}

	// PA-07: org admins see the organisation; facility managers see their facilities.
	@Get(routes.audit)
	async listAudit(@CurrentStaff() actor: StaffPrincipal): Promise<AuditEntry[]> {
		const facilityIds = await this.access.facilityIdsWith(actor, 'view_audit');
		if (facilityIds !== null && facilityIds.length === 0) {
			throw forbidden();
		}
		return this.audit.listForOrganisation(actor.organisationId, facilityIds, actor.staffId);
	}
}
