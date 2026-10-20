-- SA-04a / PA-07 / code-rules P-7: the audit log is append-only. The database itself rejects
-- UPDATE, DELETE and TRUNCATE so no code path (or manual query) can rewrite history.
CREATE FUNCTION audit_log_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
	FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
--> statement-breakpoint
-- SA-02a: the single platform_defaults row. Starting values only; the Super Admin changes them.
-- Audio retention 7 days is the PRD C7 ceiling; facility_limit 10 is an initial cap, not a metric.
INSERT INTO platform_defaults (
	enabled_record_types, pcw_requires_rn_review, audio_retention_days_max,
	ai_processing_enabled, facility_limit
) VALUES (ARRAY['progress_note', 'adl']::record_type[], true, 7, true, 10);
