// SPEC-011 PA-03 resident register and lifecycle; SPEC-009 consent (staff tokens only).
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
	type Consent,
	type ConsentUpdateRequest,
	type CsvImportResult,
	ROUTES,
	type Resident,
	type ResidentDetail,
	type ResidentEventCreateRequest,
	type ResidentEventResult,
	type ResidentUpdateRequest,
	consentUpdateRequestSchema,
	residentCreateRequestSchema,
	residentEventCreateRequestSchema,
	residentUpdateRequestSchema,
} from '@carekind/shared';
import { Audience, CurrentStaff } from '../auth/decorators.js';
import type { StaffPrincipal } from '../auth/principal.js';
import { IdPipe, SchemaPipe } from '../common/schema.pipe.js';
import { ConsentService } from './consent.service.js';
import { ResidentEventsService } from './resident-events.service.js';
import { ResidentImportService } from './resident-import.service.js';
import { ResidentsService } from './residents.service.js';

const OK = 200;
const routes = ROUTES.org;

type ResidentCreateInput = ReturnType<typeof residentCreateRequestSchema.parse>;

@Audience('org')
@Controller()
export class OrgResidentsController {
	constructor(
		private readonly residents: ResidentsService,
		private readonly events: ResidentEventsService,
		private readonly importer: ResidentImportService,
		private readonly consent: ConsentService,
	) {}

	@Get(routes.facilityResidents)
	listResidents(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) facilityId: string,
	): Promise<Resident[]> {
		return this.residents.list(actor, facilityId);
	}

	@Post(routes.facilityResidents)
	createResident(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) facilityId: string,
		@Body(new SchemaPipe(residentCreateRequestSchema)) body: ResidentCreateInput,
	): Promise<Resident> {
		return this.residents.create(actor, facilityId, body);
	}

	@Post(routes.facilityResidentsImport)
	@HttpCode(OK)
	importResidents(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) facilityId: string,
		@Body() csv: unknown,
	): Promise<CsvImportResult> {
		return this.importer.import(actor, facilityId, csv);
	}

	@Get(routes.resident)
	getResident(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<ResidentDetail> {
		return this.residents.get(actor, id);
	}

	@Patch(routes.resident)
	updateResident(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(residentUpdateRequestSchema)) body: ResidentUpdateRequest,
	): Promise<Resident> {
		return this.residents.update(actor, id, body);
	}

	@Post(routes.residentEvents)
	recordEvent(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(residentEventCreateRequestSchema)) body: ResidentEventCreateRequest,
	): Promise<ResidentEventResult> {
		return this.events.record(actor, id, body);
	}

	@Get(routes.residentConsent)
	getConsent(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
	): Promise<Consent> {
		return this.consent.get(actor, id);
	}

	@Put(routes.residentConsent)
	updateConsent(
		@CurrentStaff() actor: StaffPrincipal,
		@Param('id', IdPipe) id: string,
		@Body(new SchemaPipe(consentUpdateRequestSchema)) body: ConsentUpdateRequest,
	): Promise<Consent> {
		return this.consent.update(actor, id, body);
	}
}
