-- I let the kernel event writer return the new event id and sequence, and the
-- coverage sweep read this transaction's versions. Company RLS still applies.
grant select (event_id, seq, company_id) on audit.audit_event to aqarak_pipeline;
--> statement-breakpoint
grant select on audit.entity_version, audit.event_subject to aqarak_pipeline;
