ALTER TABLE "agents" ALTER COLUMN "policy" SET DEFAULT '{"requireRegistered":false,"minTrust":0}'::jsonb;--> statement-breakpoint
ALTER TABLE "offers" DROP COLUMN IF EXISTS "accepts_sandbox";