create index tawtheeq_review_document_version_idx on lease.tawtheeq_review(company_id, document_version_id);
--> statement-breakpoint
create index tawtheeq_review_extraction_idx on lease.tawtheeq_review(company_id, extraction_id);
