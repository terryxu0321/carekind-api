CREATE TYPE "public"."audit_actor_type" AS ENUM('platform_admin', 'staff');--> statement-breakpoint
CREATE TYPE "public"."australian_state" AS ENUM('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('self', 'supporter', 'substitute_decision_maker');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('consented', 'not_consented', 'withdrawn', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('ahpra_registration', 'worker_screening', 'police_check', 'carekind_training');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'casual', 'agency');--> statement-breakpoint
CREATE TYPE "public"."escalation_target" AS ENUM('on_duty_rn', 'don');--> statement-breakpoint
CREATE TYPE "public"."facility_role" AS ENUM('facility_manager', 'don', 'admin_officer', 'rn', 'en', 'pcw', 'no_app');--> statement-breakpoint
CREATE TYPE "public"."facility_status" AS ENUM('configuring', 'live', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."golive_item_key" AS ENUM('contract_signed', 'staff_register_imported', 'resident_register_imported', 'consent_recorded', 'staff_notice_sent', 'training_completed', 'record_transfer_agreed');--> statement-breakpoint
CREATE TYPE "public"."organisation_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('progress_note', 'adl');--> statement-breakpoint
CREATE TYPE "public"."resident_event_type" AS ENUM('admit', 'temporary_leave', 'return', 'transfer_out', 'transfer_accept', 'depart', 'death', 'archive');--> statement-breakpoint
CREATE TYPE "public"."resident_status" AS ENUM('pre_admission', 'in_residence', 'temporary_leave', 'transferring', 'departed', 'deceased', 'archived');--> statement-breakpoint
CREATE TYPE "public"."staff_lifecycle" AS ENUM('recorded', 'invited', 'pending_training', 'active', 'deactivated');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"facility_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "consent_source",
	"jurisdiction" "australian_state",
	"basis_note" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_resident_id_unique" UNIQUE("resident_id")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"reference" text,
	"expires_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"state" "australian_state" NOT NULL,
	"beds" integer NOT NULL,
	"timezone" text NOT NULL,
	"status" "facility_status" DEFAULT 'configuring' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "golive_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"key" "golive_item_key" NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"notice_sent_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abn" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"status" "organisation_status" DEFAULT 'active' NOT NULL,
	"enabled_record_types" "record_type"[] NOT NULL,
	"pcw_requires_rn_review" boolean NOT NULL,
	"audio_retention_days_max" integer NOT NULL,
	"ai_processing_enabled" boolean NOT NULL,
	"facility_limit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enabled_record_types" "record_type"[] NOT NULL,
	"pcw_requires_rn_review" boolean NOT NULL,
	"audio_retention_days_max" integer NOT NULL,
	"ai_processing_enabled" boolean NOT NULL,
	"facility_limit" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"type" "resident_event_type" NOT NULL,
	"from_facility_id" uuid,
	"to_facility_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"given_name" text NOT NULL,
	"preferred_name" text,
	"family_name" text NOT NULL,
	"room" text,
	"status" "resident_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"given_name" text NOT NULL,
	"family_name" text NOT NULL,
	"position" text NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"is_org_admin" boolean DEFAULT false NOT NULL,
	"has_app_access" boolean DEFAULT false NOT NULL,
	"email" text,
	"password_hash" text,
	"lifecycle" "staff_lifecycle" DEFAULT 'recorded' NOT NULL,
	"training_completed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"role" "facility_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"pcw_requires_rn_review" boolean NOT NULL,
	"review_record_types" "record_type"[] NOT NULL,
	"unreviewed_reminder_minutes" integer NOT NULL,
	"escalate_to" "escalation_target" NOT NULL,
	"incident_notify_roles" "facility_role"[] NOT NULL,
	"transfer_to_facility_system_days" integer NOT NULL,
	"transfer_owner_staff_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_settings_facility_id_unique" UNIQUE("facility_id")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golive_items" ADD CONSTRAINT "golive_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golive_items" ADD CONSTRAINT "golive_items_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golive_items" ADD CONSTRAINT "golive_items_completed_by_staff_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_events" ADD CONSTRAINT "resident_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_events" ADD CONSTRAINT "resident_events_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_events" ADD CONSTRAINT "resident_events_from_facility_id_facilities_id_fk" FOREIGN KEY ("from_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_events" ADD CONSTRAINT "resident_events_to_facility_id_facilities_id_fk" FOREIGN KEY ("to_facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_events" ADD CONSTRAINT "resident_events_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_settings" ADD CONSTRAINT "workflow_settings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_settings" ADD CONSTRAINT "workflow_settings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_settings" ADD CONSTRAINT "workflow_settings_transfer_owner_staff_id_staff_id_fk" FOREIGN KEY ("transfer_owner_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "golive_items_facility_key" ON "golive_items" USING btree ("facility_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_unique" ON "platform_admins" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "staff_email_unique" ON "staff" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "staff_assignments_staff_facility" ON "staff_assignments" USING btree ("staff_id","facility_id");