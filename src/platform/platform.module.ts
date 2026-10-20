import { Module } from '@nestjs/common';
import { OrgAdminsService } from './org-admins.service.js';
import { OrganisationsService } from './organisations.service.js';
import { PlatformController } from './platform.controller.js';
import { PlatformSettingsService } from './platform-settings.service.js';

@Module({
	controllers: [PlatformController],
	providers: [OrganisationsService, OrgAdminsService, PlatformSettingsService],
})
export class PlatformModule {}
