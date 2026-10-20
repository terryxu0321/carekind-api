import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service.js';
import { CredentialsService } from './credentials.service.js';
import { FacilitiesService } from './facilities.service.js';
import { GoLiveService } from './go-live.service.js';
import { OrgAccessService } from './org-access.service.js';
import { OrgFacilitiesController } from './org-facilities.controller.js';
import { OrgResidentsController } from './org-residents.controller.js';
import { OrgStaffController } from './org-staff.controller.js';
import { OverviewService } from './overview.service.js';
import { ResidentAccessService } from './resident-access.service.js';
import { ResidentEventsService } from './resident-events.service.js';
import { ResidentImportService } from './resident-import.service.js';
import { ResidentsService } from './residents.service.js';
import { StaffAccessService } from './staff-access.service.js';
import { StaffImportService } from './staff-import.service.js';
import { StaffService } from './staff.service.js';
import { WorkflowService } from './workflow.service.js';

@Module({
	controllers: [OrgFacilitiesController, OrgStaffController, OrgResidentsController],
	providers: [
		OrgAccessService,
		OverviewService,
		FacilitiesService,
		GoLiveService,
		WorkflowService,
		StaffAccessService,
		StaffService,
		StaffImportService,
		CredentialsService,
		ResidentAccessService,
		ResidentsService,
		ResidentEventsService,
		ResidentImportService,
		ConsentService,
	],
})
export class OrgModule {}
