ALTER TABLE "agents" ADD COLUMN "endpoint" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "protocols" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "homepage" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "operator_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "operator_name" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "status" text DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_seen" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_status_idx" ON "agents" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_tags_idx" ON "agents" ("tags");