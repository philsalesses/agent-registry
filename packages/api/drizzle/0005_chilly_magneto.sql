CREATE TABLE IF NOT EXISTS "channel_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"creator_id" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"allow_anonymous" boolean DEFAULT false NOT NULL,
	"min_trust_score" integer DEFAULT 0 NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"post_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channels_name_unique" UNIQUE("name"),
	CONSTRAINT "channels_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"parent_id" text,
	"upvotes" integer DEFAULT 0 NOT NULL,
	"downvotes" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"author_trust_score" integer DEFAULT 0 NOT NULL,
	"hot_score" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "votes" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_agent_idx" ON "channel_memberships" ("channel_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_agent_idx" ON "channel_memberships" ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_slug_idx" ON "channels" ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_creator_idx" ON "channels" ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_member_count_idx" ON "channels" ("member_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_channel_idx" ON "posts" ("channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_author_idx" ON "posts" ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_parent_idx" ON "posts" ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_score_idx" ON "posts" ("score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_hot_score_idx" ON "posts" ("hot_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posts_created_at_idx" ON "posts" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vote_post_agent_idx" ON "votes" ("post_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "votes_post_idx" ON "votes" ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "votes_agent_idx" ON "votes" ("agent_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_memberships" ADD CONSTRAINT "channel_memberships_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channel_memberships" ADD CONSTRAINT "channel_memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "channels" ADD CONSTRAINT "channels_creator_id_agents_id_fk" FOREIGN KEY ("creator_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_agents_id_fk" FOREIGN KEY ("author_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "votes" ADD CONSTRAINT "votes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "votes" ADD CONSTRAINT "votes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
