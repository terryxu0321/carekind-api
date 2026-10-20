// PA-04 starting workflow settings for a new facility (pure; used by the API and the seed).
import type { OrganisationLimits, WorkflowSettingsBody } from '@carekind/shared';

// Starting values for a new facility, which the facility reviews during go-live (PA-04).
// The PRD sets no default for these two numbers; they are configuration, not clinical guidance.
const INITIAL_UNREVIEWED_REMINDER_MINUTES = 60;
const INITIAL_TRANSFER_TO_FACILITY_SYSTEM_DAYS = 7;

// Review defaults are copied from the organisation's limits (SA-02 "默认值").
export function initialWorkflowSettings(limits: OrganisationLimits): WorkflowSettingsBody {
	return {
		pcwRequiresRnReview: limits.pcwRequiresRnReview,
		reviewRecordTypes: limits.enabledRecordTypes,
		unreviewedReminderMinutes: INITIAL_UNREVIEWED_REMINDER_MINUTES,
		escalateTo: 'on_duty_rn',
		incidentNotifyRoles: [],
		transferToFacilitySystemDays: INITIAL_TRANSFER_TO_FACILITY_SYSTEM_DAYS,
		transferOwnerStaffId: null,
	};
}
