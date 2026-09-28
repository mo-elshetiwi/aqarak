create index field_review_extraction_id_idx on doc.field_review(company_id, extraction_id);
--> statement-breakpoint
create index field_review_extraction_version_idx on doc.field_review(company_id, document_version_id, extraction_id);
