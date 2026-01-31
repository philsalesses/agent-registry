CREATE TABLE IF NOT EXISTS "agent_capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"endpoint" text,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"type" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attestations" (
	"id" text PRIMARY KEY NOT NULL,
	"attester_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"claim_type" text NOT NULL,
	"claim_capability_id" text,
	"claim_value" jsonb NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "capabilities" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_capability_idx" ON "agent_capabilities" ("agent_id","capability_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trust_score_idx" ON "agent_capabilities" ("trust_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_name_idx" ON "agents" ("name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_type_idx" ON "agents" ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_subject_idx" ON "attestations" ("subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_attester_idx" ON "attestations" ("attester_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_capabilities" ADD CONSTRAINT "agent_capabilities_capability_id_capabilities_id_fk" FOREIGN KEY ("capability_id") REFERENCES "capabilities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attestations" ADD CONSTRAINT "attestations_attester_id_agents_id_fk" FOREIGN KEY ("attester_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attestations" ADD CONSTRAINT "attestations_subject_id_agents_id_fk" FOREIGN KEY ("subject_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
