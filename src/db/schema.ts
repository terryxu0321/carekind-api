// M0 admin tech design §3 data model. Enum values come from @carekind/shared (code-rules D-1).
// Every business table carries organisation_id so each query can be scoped to one tenant (SA-01a, PA-01a).
import {
	AUDIT_ACTOR_TYPES,
	AUSTRALIAN_STATES,
	CONSENT_SOURCES,
	CONSENT_STATUSES,
	CREDENTIAL_KINDS,
	EMPLOYMENT_TYPES,
	ESCALATION_TARGETS,
	FACILITY_ROLES,
	FACILITY_STATUSES,
	GOLIVE_ITEM_KEYS,
	ORGANISATION_STATUSES,
	RECORD_TYPES,
	RESIDENT_EVENT_TYPES,
	RESIDENT_STATUSES,
	STAFF_LIFECYCLES,
} from '@carekind/shared';
import { sql } from 'drizzle-orm';
import {
	boolean,
	date,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

export const australianState = pgEnum('australian_state', AUSTRALIAN_STATES);
export const organisationStatus = pgEnum('organisation_status', ORGANISATION_STATUSES);
export const facilityStatus = pgEnum('facility_status', FACILITY_STATUSES);
export const recordType = pgEnum('record_type', RECORD_TYPES);
export const facilityRole = pgEnum('facility_role', FACILITY_ROLES);
export const employmentType = pgEnum('employment_type', EMPLOYMENT_TYPES);
export const staffLifecycle = pgEnum('staff_lifecycle', STAFF_LIFECYCLES);
export const credentialKind = pgEnum('credential_kind', CREDENTIAL_KINDS);
export const residentStatus = pgEnum('resident_status', RESIDENT_STATUSES);
export const residentEventType = pgEnum('resident_event_type', RESIDENT_EVENT_TYPES);
export const consentStatus = pgEnum('consent_status', CONSENT_STATUSES);
export const consentSource = pgEnum('consent_source', CONSENT_SOURCES);
export const escalationTarget = pgEnum('escalation_target', ESCALATION_TARGETS);
export const goLiveItemKey = pgEnum('golive_item_key', GOLIVE_ITEM_KEYS);
export const auditActorType = pgEnum('audit_actor_type', AUDIT_ACTOR_TYPES);

// Column helpers (module-private; Drizzle infers their exact column types).
const id = () => uuid('id').primaryKey().defaultRandom();
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
	createdAt: instant('created_at').notNull().defaultNow(),
	updatedAt: instant('updated_at').notNull().defaultNow(),
};
const calendarDate = (name: string) => date(name, { mode: 'string' });

export const platformAdmins = pgTable(
	'platform_admins',
	{
		id: id(),
		email: text('email').notNull(),
		name: text('name').notNull(),
		passwordHash: text('password_hash').notNull(),
		isActive: boolean('is_active').notNull().default(true),
		...timestamps,
	},
	(table) => [uniqueIndex('platform_admins_email_unique').on(sql`lower(${table.email})`)],
);

// SA-02 / SA-02a: limits live on platform_defaults (one row) and are copied onto each organisation.
const limitColumns = {
	enabledRecordTypes: recordType('enabled_record_types').array().notNull(),
	pcwRequiresRnReview: boolean('pcw_requires_rn_review').notNull(),
	audioRetentionDaysMax: integer('audio_retention_days_max').notNull(),
	aiProcessingEnabled: boolean('ai_processing_enabled').notNull(),
	facilityLimit: integer('facility_limit').notNull(),
};

export const platformDefaults = pgTable('platform_defaults', {
	id: id(),
	...limitColumns,
	...timestamps,
});

export const organisations = pgTable('organisations', {
	id: id(),
	name: text('name').notNull(),
	abn: text('abn').notNull(),
	contactName: text('contact_name').notNull(),
	contactEmail: text('contact_email').notNull(),
	status: organisationStatus('status').notNull().default('active'),
	...limitColumns,
	...timestamps,
});

export const facilities = pgTable('facilities', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	name: text('name').notNull(),
	address: text('address').notNull(),
	state: australianState('state').notNull(),
	beds: integer('beds').notNull(),
	timezone: text('timezone').notNull(),
	status: facilityStatus('status').notNull().default('configuring'),
	...timestamps,
});

export const staff = pgTable(
	'staff',
	{
		id: id(),
		organisationId: uuid('organisation_id')
			.notNull()
			.references(() => organisations.id),
		givenName: text('given_name').notNull(),
		familyName: text('family_name').notNull(),
		position: text('position').notNull(),
		employmentType: employmentType('employment_type').notNull(),
		isOrgAdmin: boolean('is_org_admin').notNull().default(false),
		hasAppAccess: boolean('has_app_access').notNull().default(false),
		email: text('email'),
		passwordHash: text('password_hash'),
		lifecycle: staffLifecycle('lifecycle').notNull().default('recorded'),
		trainingCompletedAt: instant('training_completed_at'),
		// SA-04 usage "staff logged in during the last 7 days" (aggregate count only).
		lastLoginAt: instant('last_login_at'),
		...timestamps,
	},
	// Email is the sign-in name, so it must be unique across all organisations.
	(table) => [uniqueIndex('staff_email_unique').on(sql`lower(${table.email})`)],
);

export const staffAssignments = pgTable(
	'staff_assignments',
	{
		id: id(),
		organisationId: uuid('organisation_id')
			.notNull()
			.references(() => organisations.id),
		staffId: uuid('staff_id')
			.notNull()
			.references(() => staff.id),
		facilityId: uuid('facility_id')
			.notNull()
			.references(() => facilities.id),
		role: facilityRole('role').notNull(),
		...timestamps,
	},
	(table) => [
		uniqueIndex('staff_assignments_staff_facility').on(table.staffId, table.facilityId),
	],
);

export const credentials = pgTable('credentials', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	staffId: uuid('staff_id')
		.notNull()
		.references(() => staff.id),
	kind: credentialKind('kind').notNull(),
	reference: text('reference'),
	expiresAt: calendarDate('expires_at'),
	...timestamps,
});

// Only a hash of the one-time token is stored; the link itself is shown once to the inviter.
export const invites = pgTable('invites', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	staffId: uuid('staff_id')
		.notNull()
		.references(() => staff.id),
	tokenHash: text('token_hash').notNull().unique(),
	expiresAt: instant('expires_at').notNull(),
	usedAt: instant('used_at'),
	...timestamps,
});

// No date of birth or photo in M0 (tech design §3).
export const residents = pgTable('residents', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	facilityId: uuid('facility_id')
		.notNull()
		.references(() => facilities.id),
	givenName: text('given_name').notNull(),
	preferredName: text('preferred_name'),
	familyName: text('family_name').notNull(),
	room: text('room'),
	status: residentStatus('status').notNull(),
	...timestamps,
});

export const residentEvents = pgTable('resident_events', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	residentId: uuid('resident_id')
		.notNull()
		.references(() => residents.id),
	type: residentEventType('type').notNull(),
	fromFacilityId: uuid('from_facility_id').references(() => facilities.id),
	toFacilityId: uuid('to_facility_id').references(() => facilities.id),
	occurredAt: instant('occurred_at').notNull(),
	recordedBy: uuid('recorded_by')
		.notNull()
		.references(() => staff.id),
	...timestamps,
});

// No row means "unknown", which is treated as not consented (SPEC-009 M-02).
export const consents = pgTable('consents', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	residentId: uuid('resident_id')
		.notNull()
		.unique()
		.references(() => residents.id),
	status: consentStatus('status').notNull(),
	source: consentSource('source'),
	jurisdiction: australianState('jurisdiction'),
	basisNote: text('basis_note'),
	recordedBy: uuid('recorded_by').references(() => staff.id),
	recordedAt: instant('recorded_at'),
	...timestamps,
});

export const workflowSettings = pgTable('workflow_settings', {
	id: id(),
	organisationId: uuid('organisation_id')
		.notNull()
		.references(() => organisations.id),
	facilityId: uuid('facility_id')
		.notNull()
		.unique()
		.references(() => facilities.id),
	pcwRequiresRnReview: boolean('pcw_requires_rn_review').notNull(),
	reviewRecordTypes: recordType('review_record_types').array().notNull(),
	unreviewedReminderMinutes: integer('unreviewed_reminder_minutes').notNull(),
	escalateTo: escalationTarget('escalate_to').notNull(),
	incidentNotifyRoles: facilityRole('incident_notify_roles').array().notNull(),
	transferToFacilitySystemDays: integer('transfer_to_facility_system_days').notNull(),
	transferOwnerStaffId: uuid('transfer_owner_staff_id').references(() => staff.id),
	...timestamps,
});

export const goLiveItems = pgTable(
	'golive_items',
	{
		id: id(),
		organisationId: uuid('organisation_id')
			.notNull()
			.references(() => organisations.id),
		facilityId: uuid('facility_id')
			.notNull()
			.references(() => facilities.id),
		key: goLiveItemKey('key').notNull(),
		completedAt: instant('completed_at'),
		completedBy: uuid('completed_by').references(() => staff.id),
		noticeSentOn: calendarDate('notice_sent_on'),
		...timestamps,
	},
	(table) => [uniqueIndex('golive_items_facility_key').on(table.facilityId, table.key)],
);

// Append-only: a trigger in migrations rejects UPDATE, DELETE and TRUNCATE (SA-04a, PA-07).
// facility_id lets facility-level roles see only their own facilities' entries.
export const auditLog = pgTable('audit_log', {
	id: id(),
	organisationId: uuid('organisation_id').references(() => organisations.id),
	facilityId: uuid('facility_id').references(() => facilities.id),
	actorType: auditActorType('actor_type').notNull(),
	actorId: uuid('actor_id').notNull(),
	action: text('action').notNull(),
	entity: text('entity').notNull(),
	entityId: uuid('entity_id'),
	occurredAt: instant('occurred_at').notNull().defaultNow(),
	summary: text('summary').notNull(),
	...timestamps,
});
