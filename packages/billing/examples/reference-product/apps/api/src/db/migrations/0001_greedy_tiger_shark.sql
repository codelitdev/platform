ALTER TABLE "billing_checkout_attempts" ADD COLUMN "payer_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkout_attempts" ADD COLUMN "return_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_provider_customers" ADD COLUMN "payer_email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD COLUMN "checkout_attempt_id" text;