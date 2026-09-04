CREATE TABLE IF NOT EXISTS "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_catalog_revision_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_revision_id" uuid NOT NULL,
	"offer_key" text NOT NULL,
	"billing_price_entry_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_catalog_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision" integer NOT NULL,
	"checkout_provider" text NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verified_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_catalog_revisions_revision_unique" UNIQUE("revision"),
	CONSTRAINT "billing_catalog_revisions_status_check" CHECK ("billing_catalog_revisions"."status" IN ('pending_verification', 'active', 'retired', 'invalid', 'abandoned')),
	CONSTRAINT "billing_catalog_revisions_revision_check" CHECK ("billing_catalog_revisions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" text NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"payer_id" text NOT NULL,
	"provider" text NOT NULL,
	"catalog_revision" integer NOT NULL,
	"offer_key" text NOT NULL,
	"requested_plan" text NOT NULL,
	"requested_interval" text NOT NULL,
	"billing_price_entry_id" uuid NOT NULL,
	"quoted_amount_minor" integer NOT NULL,
	"quoted_currency" text NOT NULL,
	"billing_customer_id" uuid,
	"provider_checkout_session_id" text,
	"checkout_url_encrypted" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkout_attempts_attempt_id_unique" UNIQUE("attempt_id"),
	CONSTRAINT "billing_checkout_attempts_status_check" CHECK ("billing_checkout_attempts"."status" IN ('creating', 'open', 'completed', 'expired', 'abandoned', 'conflicted')),
	CONSTRAINT "billing_checkout_attempts_amount_check" CHECK ("billing_checkout_attempts"."quoted_amount_minor" > 0),
	CONSTRAINT "billing_checkout_attempts_plan_check" CHECK ("billing_checkout_attempts"."requested_plan" IN ('pro', 'business')),
	CONSTRAINT "billing_checkout_attempts_interval_check" CHECK ("billing_checkout_attempts"."requested_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_plan_change_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_id" text NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"current_catalog_revision" integer NOT NULL,
	"current_billing_price_entry_id" uuid NOT NULL,
	"current_plan" text NOT NULL,
	"current_interval" text NOT NULL,
	"target_catalog_revision" integer NOT NULL,
	"target_billing_price_entry_id" uuid NOT NULL,
	"target_plan" text NOT NULL,
	"target_interval" text NOT NULL,
	"target_offer_key" text NOT NULL,
	"effective_at" text NOT NULL,
	"proration_mode" text NOT NULL,
	"provider_payment_id" text,
	"payment_url_encrypted" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plan_change_attempts_change_id_unique" UNIQUE("change_id"),
	CONSTRAINT "billing_plan_change_attempts_status_check" CHECK ("billing_plan_change_attempts"."status" IN ('creating', 'pending', 'succeeded', 'failed', 'conflicted')),
	CONSTRAINT "billing_plan_change_attempts_effective_at_check" CHECK ("billing_plan_change_attempts"."effective_at" IN ('immediately', 'next_billing_date')),
	CONSTRAINT "billing_plan_change_attempts_proration_mode_check" CHECK ("billing_plan_change_attempts"."proration_mode" IN ('prorated_immediately', 'do_not_bill')),
	CONSTRAINT "billing_plan_change_attempts_current_plan_check" CHECK ("billing_plan_change_attempts"."current_plan" IN ('pro', 'business')),
	CONSTRAINT "billing_plan_change_attempts_target_plan_check" CHECK ("billing_plan_change_attempts"."target_plan" IN ('pro', 'business'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_plan_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"active_subscription_id" uuid,
	"projection_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plan_states_billable_entity_id_unique" UNIQUE("billable_entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_price_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_key" text NOT NULL,
	"plan" text NOT NULL,
	"billing_interval" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_price_entries_amount_check" CHECK ("billing_price_entries"."amount_minor" > 0),
	CONSTRAINT "billing_price_entries_currency_check" CHECK ("billing_price_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_price_entries_plan_check" CHECK ("billing_price_entries"."plan" IN ('pro', 'business')),
	CONSTRAINT "billing_price_entries_interval_check" CHECK ("billing_price_entries"."billing_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_provider_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"payer_id" text NOT NULL,
	"provider_customer_id" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_provider_customers_status_check" CHECK ("billing_provider_customers"."status" IN ('creating', 'active', 'conflicted'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_reconciliation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"checkout_attempt_id" uuid,
	"plan_change_attempt_id" uuid,
	"subscription_id" uuid,
	"provider_customer_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_reconciliation_jobs_exactly_one_subject" CHECK (((CASE WHEN "billing_reconciliation_jobs"."checkout_attempt_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "billing_reconciliation_jobs"."plan_change_attempt_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "billing_reconciliation_jobs"."subscription_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "billing_reconciliation_jobs"."provider_customer_id" IS NOT NULL THEN 1 ELSE 0 END)) = 1),
	CONSTRAINT "billing_reconciliation_jobs_status_check" CHECK ("billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed', 'completed', 'quarantined'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billable_entity_id" uuid NOT NULL,
	"billing_customer_id" uuid NOT NULL,
	"payer_id" text NOT NULL,
	"origin_checkout_attempt_id" uuid,
	"provider" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"provider_product_id" text NOT NULL,
	"billing_price_entry_id" uuid NOT NULL,
	"catalog_revision" integer NOT NULL,
	"offer_key" text NOT NULL,
	"plan" text NOT NULL,
	"billing_interval" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_period_starts_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"paid_through_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"is_entitlement_source" boolean DEFAULT false NOT NULL,
	"provider_occurred_at" timestamp with time zone,
	"provider_version" text,
	"last_observed_at" timestamp with time zone,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_status_check" CHECK ("billing_subscriptions"."status" IN ('pending', 'trialing', 'active', 'past_due', 'cancelled', 'expired')),
	CONSTRAINT "billing_subscriptions_plan_check" CHECK ("billing_subscriptions"."plan" IN ('pro', 'business')),
	CONSTRAINT "billing_subscriptions_interval_check" CHECK ("billing_subscriptions"."billing_interval" IN ('month', 'year'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_encrypted" text,
	"payload_key_version" text,
	"verified_key_version" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"worker_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "billing_webhook_events_status_check" CHECK ("billing_webhook_events"."status" IN ('pending', 'processing', 'processed', 'ignored', 'quarantined', 'failed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_catalog_revision_items" ADD CONSTRAINT "billing_catalog_revision_items_catalog_revision_id_billing_catalog_revisions_id_fk" FOREIGN KEY ("catalog_revision_id") REFERENCES "public"."billing_catalog_revisions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_catalog_revision_items" ADD CONSTRAINT "billing_catalog_revision_items_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billable_entity_id_workspaces_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_payer_id_accounts_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_checkout_attempts" ADD CONSTRAINT "billing_checkout_attempts_billing_customer_id_billing_provider_customers_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_provider_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_billable_entity_id_workspaces_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_payer_id_accounts_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_current_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("current_billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_change_attempts" ADD CONSTRAINT "billing_plan_change_attempts_target_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("target_billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_states" ADD CONSTRAINT "billing_plan_states_billable_entity_id_workspaces_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_plan_states" ADD CONSTRAINT "billing_plan_states_active_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("active_subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_provider_customers" ADD CONSTRAINT "billing_provider_customers_payer_id_accounts_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_checkout_attempt_id_billing_checkout_attempts_id_fk" FOREIGN KEY ("checkout_attempt_id") REFERENCES "public"."billing_checkout_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_plan_change_attempt_id_billing_plan_change_attempts_id_fk" FOREIGN KEY ("plan_change_attempt_id") REFERENCES "public"."billing_plan_change_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_subscription_id_billing_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."billing_subscriptions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_reconciliation_jobs" ADD CONSTRAINT "billing_reconciliation_jobs_provider_customer_id_billing_provider_customers_id_fk" FOREIGN KEY ("provider_customer_id") REFERENCES "public"."billing_provider_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billable_entity_id_workspaces_id_fk" FOREIGN KEY ("billable_entity_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_customer_id_billing_provider_customers_id_fk" FOREIGN KEY ("billing_customer_id") REFERENCES "public"."billing_provider_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_payer_id_accounts_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_origin_checkout_attempt_id_billing_checkout_attempts_id_fk" FOREIGN KEY ("origin_checkout_attempt_id") REFERENCES "public"."billing_checkout_attempts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_billing_price_entry_id_billing_price_entries_id_fk" FOREIGN KEY ("billing_price_entry_id") REFERENCES "public"."billing_price_entries"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_catalog_revision_items_revision_key_uidx" ON "billing_catalog_revision_items" USING btree ("catalog_revision_id","offer_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_catalog_revision_items_revision_price_uidx" ON "billing_catalog_revision_items" USING btree ("catalog_revision_id","billing_price_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_catalog_revisions_active_provider_uidx" ON "billing_catalog_revisions" USING btree ("checkout_provider") WHERE "billing_catalog_revisions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkout_attempts_provider_session_uidx" ON "billing_checkout_attempts" USING btree ("provider","provider_checkout_session_id") WHERE "billing_checkout_attempts"."provider_checkout_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkout_attempts_idempotency_uidx" ON "billing_checkout_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_checkout_attempts_entity_nonterminal_uidx" ON "billing_checkout_attempts" USING btree ("billable_entity_id") WHERE "billing_checkout_attempts"."status" IN ('creating', 'open');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plan_change_attempts_idempotency_uidx" ON "billing_plan_change_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_plan_change_attempts_entity_nonterminal_uidx" ON "billing_plan_change_attempts" USING btree ("billable_entity_id") WHERE "billing_plan_change_attempts"."status" IN ('creating', 'pending');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_price_entries_provider_product_uidx" ON "billing_price_entries" USING btree ("provider","provider_product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_price_entries_offer_key_idx" ON "billing_price_entries" USING btree ("offer_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_customers_provider_payer_uidx" ON "billing_provider_customers" USING btree ("provider","payer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_customers_provider_customer_uidx" ON "billing_provider_customers" USING btree ("provider","provider_customer_id") WHERE "billing_provider_customers"."provider_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_provider_customers_idempotency_uidx" ON "billing_provider_customers" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_checkout_uidx" ON "billing_reconciliation_jobs" USING btree ("checkout_attempt_id") WHERE "billing_reconciliation_jobs"."checkout_attempt_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_plan_change_uidx" ON "billing_reconciliation_jobs" USING btree ("plan_change_attempt_id") WHERE "billing_reconciliation_jobs"."plan_change_attempt_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_subscription_uidx" ON "billing_reconciliation_jobs" USING btree ("subscription_id") WHERE "billing_reconciliation_jobs"."subscription_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_reconciliation_jobs_live_customer_uidx" ON "billing_reconciliation_jobs" USING btree ("provider_customer_id") WHERE "billing_reconciliation_jobs"."provider_customer_id" IS NOT NULL AND "billing_reconciliation_jobs"."status" IN ('pending', 'processing', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_provider_subscription_uidx" ON "billing_subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_entity_source_uidx" ON "billing_subscriptions" USING btree ("billable_entity_id") WHERE "billing_subscriptions"."is_entitlement_source" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_webhook_events_provider_event_uidx" ON "billing_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_webhook_events_queue_idx" ON "billing_webhook_events" USING btree ("status","available_at");