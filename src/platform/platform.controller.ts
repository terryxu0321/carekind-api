// SPEC-010 Super Admin endpoints. platform_admin tokens only (Audience guard); SA-05: no residents,
// consents or staff-register detail is ever returned from here.
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
	type AdminInviteRequest,
	type AuditEntry,
	type FacilitySummary,
	type InviteLinkResponse,
	type OrgAdminSummary,
	type Organisation,
	type OrganisationCreateRequest,
	type OrganisationLimits,
	type OrganisationUpdateRequest,
	type PlatformDefaults,
	ROUTES,
	type UsageResponse,
	adminInviteRequestSchema,
	organisationCreateRequestSchema,
	organisationLimitsSchema,
	organisationUpdateRequestSchema,
	platformDefaultsSchema,
} from '@carekind/shared';
import { Audience, CurrentPlatformAdmin } from '../auth/decorators.js';
import type { PlatformPrincipal } from '../auth/principal.js';
import { AuditService } from '../common/audit.service.js';
import { IdPipe, SchemaPipe } from '../common/schema.pipe.js';
import { OrgAdminsService } from './org-admins.service.js';
import { OrganisationsService } from './organisations.service.js';
import { PlatformSettingsService } from './platform-settings.service.js';

const OK = 200;
const routes = ROUTES.platform;

@Audience('platform')
@Controller()
export class PlatformController {
	constructor(
		private readonly organisations: OrganisationsService,
		private readonly orgAdmins: OrgAdminsService,
		private readonly settings: PlatformSettingsService,
		private readonly audit: AuditService,
	) {}

	@Get(routes.organisations)
	listOrganisations(): Promise<Organisation[]> {
		return this.organisations.list();
	}

	@Post(routes.organisations)
	createOrganisation(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Body(new SchemaPipe(organisationCreateRequestSchema)) body: OrganisationCreateRequest,
	): Promise<Organisation> {
		return this.organisations.create(actor, body);
	}

	@Get(routes.organisation)
	getOrganisation(@Param('id', IdPipe) id: string): Promise<Organisation> {
		return this.organisations.get(id);
	}

	@Patch(routes.organisation)
	updateOrganisation(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(organisationUpdateRequestSchema)) body: OrganisationUpdateRequest,
	): Promise<Organisation> {
		return this.organisations.update(actor, id, body);
	}

	@Post(routes.organisationSuspend)
	@HttpCode(OK)
	suspendOrganisation(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Organisation> {
		return this.organisations.setStatus(actor, id, 'suspended');
	}

	@Post(routes.organisationReactivate)
	@HttpCode(OK)
	reactivateOrganisation(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Organisation> {
		return this.organisations.setStatus(actor, id, 'active');
	}

	@Put(routes.organisationLimits)
	updateLimits(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(organisationLimitsSchema)) body: OrganisationLimits,
	): Promise<Organisation> {
		return this.organisations.updateLimits(actor, id, body);
	}

	@Get(routes.organisationFacilities)
	listFacilities(@Param('id', IdPipe) id: string): Promise<FacilitySummary[]> {
		return this.organisations.listFacilities(id);
	}

	@Get(routes.organisationAdmins)
	listAdmins(@Param('id', IdPipe) id: string): Promise<OrgAdminSummary[]> {
		return this.orgAdmins.list(id);
	}

	@Post(routes.organisationAdminInvites)
	inviteAdmin(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(adminInviteRequestSchema)) body: AdminInviteRequest,
	): Promise<InviteLinkResponse> {
		return this.orgAdmins.invite(actor, id, body);
	}

	@Post(routes.adminDeactivate)
	@HttpCode(OK)
	deactivateAdmin(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Param('staffId', IdPipe) staffId: string,
	): Promise<OrgAdminSummary> {
		return this.orgAdmins.deactivate(actor, staffId);
	}

	@Get(routes.defaults)
	getDefaults(): Promise<PlatformDefaults> {
		return this.settings.getDefaults();
	}

	@Put(routes.defaults)
	updateDefaults(
		@CurrentPlatformAdmin() actor: PlatformPrincipal,
		@Body(new SchemaPipe(platformDefaultsSchema)) body: PlatformDefaults,
	): Promise<PlatformDefaults> {
		return this.settings.updateDefaults(actor, body);
	}

	@Get(routes.usage)
	getUsage(): Promise<UsageResponse> {
		return this.settings.usage();
	}

	@Get(routes.audit)
	listAudit(): Promise<AuditEntry[]> {
		return this.audit.listPlatformActions();
	}
}
