// SPEC-011 PA-02 staff register, assignments, lifecycle and credentials (staff tokens only).
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
	type Credential,
	type CredentialCreateRequest,
	type CredentialUpdateRequest,
	type CsvImportResult,
	type InviteLinkResponse,
	ROUTES,
	type Staff,
	type StaffAssignmentsUpdateRequest,
	type StaffImportQuery,
	type StaffListQuery,
	type StaffUpdateRequest,
	credentialCreateRequestSchema,
	credentialUpdateRequestSchema,
	staffAssignmentsUpdateRequestSchema,
	staffCreateRequestSchema,
	staffImportQuerySchema,
	staffListQuerySchema,
	staffUpdateRequestSchema,
} from '@carekind/shared';
import { Audience, CurrentStaff } from '../auth/decorators.js';
import type { StaffPrincipal } from '../auth/principal.js';
import { IdPipe, SchemaPipe } from '../common/schema.pipe.js';
import { CredentialsService } from './credentials.service.js';
import { StaffImportService } from './staff-import.service.js';
import { StaffService } from './staff.service.js';

const OK = 200;
const NO_CONTENT = 204;
const routes = ROUTES.org;

type StaffCreateInput = ReturnType<typeof staffCreateRequestSchema.parse>;

@Audience('org')
@Controller()
export class OrgStaffController {
	constructor(
		private readonly staffService: StaffService,
		private readonly importer: StaffImportService,
		private readonly credentials: CredentialsService,
	) {}

	@Get(routes.staffList)
	listStaff(
		@CurrentStaff() actor: StaffPrincipal,
		@Query(new SchemaPipe(staffListQuerySchema)) query: StaffListQuery,
	): Promise<Staff[]> {
		return this.staffService.list(actor, query);
	}

	@Post(routes.staffList)
	createStaff(
		@CurrentStaff() actor: StaffPrincipal,
		@Body(new SchemaPipe(staffCreateRequestSchema)) body: StaffCreateInput,
	): Promise<Staff> {
		return this.staffService.create(actor, body);
	}

	// Body is text/csv; the facility comes from the query (shared client importStaff).
	@Post(routes.staffImport)
	@HttpCode(OK)
	importStaff(
		@CurrentStaff() actor: StaffPrincipal,
		@Query(new SchemaPipe(staffImportQuerySchema)) query: StaffImportQuery,
		@Body() csv: unknown,
	): Promise<CsvImportResult> {
		return this.importer.import(actor, query.facilityId, csv);
	}

	@Get(routes.staff)
	getStaff(@CurrentStaff() actor: StaffPrincipal, @Param('id', IdPipe) id: string): Promise<Staff> {
		return this.staffService.get(actor, id);
	}

	@Patch(routes.staff)
	updateStaff(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(staffUpdateRequestSchema)) body: StaffUpdateRequest,
	): Promise<Staff> {
		return this.staffService.update(actor, id, body);
	}

	@Put(routes.staffAssignments)
	updateAssignments(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(staffAssignmentsUpdateRequestSchema)) body: StaffAssignmentsUpdateRequest,
	): Promise<Staff> {
		return this.staffService.updateAssignments(actor, id, body.assignments);
	}

	@Post(routes.staffInvite)
	@HttpCode(OK)
	invite(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<InviteLinkResponse> {
		return this.staffService.invite(actor, id);
	}

	@Post(routes.staffTrainingComplete)
	@HttpCode(OK)
	completeTraining(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Staff> {
		return this.staffService.completeTraining(actor, id);
	}

	@Post(routes.staffDeactivate)
	@HttpCode(OK)
	deactivate(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Staff> {
		return this.staffService.deactivate(actor, id);
	}

	@Get(routes.staffCredentials)
	listCredentials(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Credential[]> {
		return this.credentials.list(actor, id);
	}

	@Post(routes.staffCredentials)
	createCredential(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(credentialCreateRequestSchema)) body: CredentialCreateRequest,
	): Promise<Credential> {
		return this.credentials.create(actor, id, body);
	}

	@Patch(routes.staffCredential)
	updateCredential(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Param('credentialId', IdPipe) credentialId: string,
		@Body(new SchemaPipe(credentialUpdateRequestSchema)) body: CredentialUpdateRequest,
	): Promise<Credential> {
		return this.credentials.update(actor, id, credentialId, body);
	}

	@Delete(routes.staffCredential)
	@HttpCode(NO_CONTENT)
	deleteCredential(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Param('credentialId', IdPipe) credentialId: string,
	): Promise<void> {
		return this.credentials.remove(actor, id, credentialId);
	}
}
