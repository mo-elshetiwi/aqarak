alter table party.owner add column self_managed boolean not null default false;
--> statement-breakpoint
create unique index owner_self_managed_company_idx on party.owner(company_id) where self_managed;
--> statement-breakpoint
alter table estate.property add column prp_number text, add column zone text, add column use text check (use in ('residential','commercial','mixed'));
--> statement-breakpoint
create unique index property_prp_number_company_idx on estate.property(company_id, prp_number) where prp_number is not null;
--> statement-breakpoint
alter table estate.mandate_property add column status text not null default 'active' check (status in ('active','removed'));
--> statement-breakpoint
create unique index owner_mandate_active_owner_idx on estate.owner_mandate(company_id, owner_id) where status = 'active';
