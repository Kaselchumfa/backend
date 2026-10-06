ALTER TABLE "publishers" ADD COLUMN "rate_limit_requests" integer;
--> statement-breakpoint
ALTER TABLE "publishers" ADD COLUMN "rate_limit_window_seconds" integer;
--> statement-breakpoint
ALTER TABLE "publishers" ADD COLUMN "rate_limit_enabled" boolean DEFAULT false NOT NULL;