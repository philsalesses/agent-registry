CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"agent_id" text NOT NULL,
	"label" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spend_cap_micros_per_day" bigint DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "funnel_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"receipt_id" text,
	"offer_id" text,
	"agent_id" text,
	"src" text,
	"ip_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"agent_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("agent_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"klass" text NOT NULL,
	"balance_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"txn_id" text NOT NULL,
	"account_id" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ledger_txns" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"type" text NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"idempotency_key" text NOT NULL,
	"actor_agent_id" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"input_schema_hash" text NOT NULL,
	"output_schema_hash" text NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_micros" bigint DEFAULT 0 NOT NULL,
	"price_unit" text DEFAULT 'call' NOT NULL,
	"accepts_sandbox" boolean DEFAULT true NOT NULL,
	"endpoint" text,
	"transport" text DEFAULT 'ans-http' NOT NULL,
	"mode" text DEFAULT 'sync' NOT NULL,
	"timeout_ms" integer DEFAULT 30000 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"probe_ok" boolean,
	"probed_at" timestamp,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"publish_sig" text NOT NULL,
	"requires" jsonb,
	"feeds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payout_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"destination_index" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hold_txn_id" text,
	"payout_txn_id" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"rater_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"score" integer NOT NULL,
	"tags" jsonb,
	"note" text,
	"signature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revealed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipt_events" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor" text NOT NULL,
	"payload" jsonb,
	"signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text,
	"provider_id" text,
	"initiator_id" text NOT NULL,
	"initiator_role" text NOT NULL,
	"counterparty_hint" jsonb,
	"claim_token_hash" text,
	"offer_id" text,
	"task" text NOT NULL,
	"input_hash" text,
	"output_hash" text,
	"output_url" text,
	"price_micros" bigint DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"credit_class" text DEFAULT 'none' NOT NULL,
	"fee_bps" integer NOT NULL,
	"fee_micros" bigint DEFAULT 0 NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"review_window_sec" integer DEFAULT 604800 NOT NULL,
	"via" text DEFAULT 'direct' NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"terms_hash" text NOT NULL,
	"initiator_sig" text NOT NULL,
	"counterparty_sig" text,
	"sig_material" jsonb,
	"deliver_sig" text,
	"verdict_sig" text,
	"open_nonce" text NOT NULL,
	"client_rating" integer,
	"provider_rating" integer,
	"ratings_revealed_at" timestamp,
	"hash" text,
	"prev_hash_client" text,
	"prev_hash_provider" text,
	"opened_at" timestamp,
	"accepted_at" timestamp,
	"delivered_at" timestamp,
	"verdict_at" timestamp,
	"sealed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_nonces" (
	"agent_id" text NOT NULL,
	"nonce" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "request_nonces_pk" PRIMARY KEY("agent_id","nonce")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "handle" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "referred_by" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "trust_score" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "trust_confidence" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "trust_rank" real DEFAULT 35 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "trust_computed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "receipt_counts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "policy" jsonb DEFAULT '{"requireRegistered":false,"minTrust":0,"acceptSandbox":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_house" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "is_seed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "receipt_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_agent_idx" ON "api_keys" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "funnel_events_event_created_idx" ON "funnel_events" ("event","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx" ON "idempotency_keys" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_owner_idx" ON "ledger_accounts" ("owner_type","owner_id","kind","klass");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_txn_idx" ON "ledger_entries" ("txn_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_entries_account_idx" ON "ledger_entries" ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_txns_idempotency_idx" ON "ledger_txns" ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ledger_txns_seq_idx" ON "ledger_txns" ("seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ledger_txns_ref_idx" ON "ledger_txns" ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "offers_agent_slug_version_idx" ON "offers" ("agent_id","slug","version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_agent_idx" ON "offers" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_status_idx" ON "offers" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_input_schema_hash_idx" ON "offers" ("input_schema_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_output_schema_hash_idx" ON "offers" ("output_schema_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offers_tags_idx" ON "offers" ("tags");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_requests_agent_idx" ON "payout_requests" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payout_requests_status_idx" ON "payout_requests" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ratings_receipt_rater_idx" ON "ratings" ("receipt_id","rater_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ratings_subject_idx" ON "ratings" ("subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_events_receipt_idx" ON "receipt_events" ("receipt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipt_events_created_at_idx" ON "receipt_events" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_client_idx" ON "receipts" ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_provider_idx" ON "receipts" ("provider_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_initiator_idx" ON "receipts" ("initiator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_state_idx" ON "receipts" ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_deadline_idx" ON "receipts" ("deadline_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_delivered_idx" ON "receipts" ("delivered_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_sealed_idx" ON "receipts" ("sealed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_offer_idx" ON "receipts" ("offer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "receipts_claim_token_idx" ON "receipts" ("claim_token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_nonces_created_at_idx" ON "request_nonces" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_handle_idx" ON "agents" ("handle");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_trust_rank_idx" ON "agents" ("trust_rank");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_referred_by_idx" ON "agents" ("referred_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_receipt_idx" ON "messages" ("receipt_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_referred_by_agents_id_fk" FOREIGN KEY ("referred_by") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_txn_id_ledger_txns_id_fk" FOREIGN KEY ("txn_id") REFERENCES "ledger_txns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offers" ADD CONSTRAINT "offers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ratings" ADD CONSTRAINT "ratings_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_agents_id_fk" FOREIGN KEY ("rater_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ratings" ADD CONSTRAINT "ratings_subject_id_agents_id_fk" FOREIGN KEY ("subject_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipt_events" ADD CONSTRAINT "receipt_events_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_client_id_agents_id_fk" FOREIGN KEY ("client_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_provider_id_agents_id_fk" FOREIGN KEY ("provider_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_initiator_id_agents_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "agents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "receipts" ADD CONSTRAINT "receipts_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- ============================================================================
-- Hand-written tail (docs/DESIGN.md sections 3, 6, 14). Every statement below
-- is idempotent so the file can be replayed against a partially migrated DB.
-- ============================================================================
DO $$ BEGIN
 ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_nonzero" CHECK ("amount_micros" <> 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ratings" ADD CONSTRAINT "ratings_score_range" CHECK ("score" >= 0 AND "score" <= 100);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_handle_format" CHECK ("handle" IS NULL OR "handle" ~ '^[a-z0-9-]{3,32}$');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Append-only: ledger_txns and ledger_entries can never be updated or deleted.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ledger_txns_append_only ON "ledger_txns";
--> statement-breakpoint
CREATE TRIGGER ledger_txns_append_only BEFORE UPDATE OR DELETE ON "ledger_txns"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS ledger_entries_append_only ON "ledger_entries";
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
--> statement-breakpoint
-- Zero-sum: the entries of one txn must sum to zero, checked at commit.
CREATE OR REPLACE FUNCTION ledger_txn_zero_sum() RETURNS trigger AS $$
DECLARE
  total bigint;
  n integer;
BEGIN
  SELECT COALESCE(SUM(amount_micros), 0), COUNT(*) INTO total, n FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger txn % entries sum to %, expected 0', NEW.txn_id, total
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'ledger txn % needs at least two entries', NEW.txn_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS ledger_entries_zero_sum ON "ledger_entries";
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_zero_sum AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_txn_zero_sum();
--> statement-breakpoint
-- System ledger accounts (section 3). Ids are fixed so code can address them.
INSERT INTO "ledger_accounts" ("id", "owner_type", "owner_id", "kind", "klass", "balance_micros") VALUES
  ('acc_sys_sandbox_source', 'system', 'sandbox_source', 'available', 'sandbox', 0),
  ('acc_sys_fee_revenue', 'system', 'fee_revenue', 'available', 'cash', 0),
  ('acc_sys_fee_burn', 'system', 'fee_burn', 'available', 'sandbox', 0),
  ('acc_sys_stripe_clearing', 'system', 'stripe_clearing', 'available', 'cash', 0),
  ('acc_sys_payout_clearing', 'system', 'payout_clearing', 'available', 'cash', 0)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- System flags (14.15)
INSERT INTO "system_flags" ("key", "value") VALUES
  ('ledger_frozen', 'false'::jsonb),
  ('registrations_paused', 'false'::jsonb),
  ('house_daily_budget_micros', '"25000000"'::jsonb),
  ('house_spent_today_micros', '"0"'::jsonb)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- jsonb written by drizzle 0.29 + postgres.js before the driver fix was double-encoded (stored as a JSON
-- string holding the real JSON). Unwrap those values in place before any SQL reads them.
CREATE OR REPLACE FUNCTION ans_jsonb_unwrap(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE inner_text text;
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'string' THEN RETURN v; END IF;
  inner_text := v #>> '{}';
  IF inner_text !~ '^\s*[\[{"0-9tfn-]' THEN RETURN v; END IF;
  BEGIN
    RETURN inner_text::jsonb;
  EXCEPTION WHEN others THEN
    RETURN v;
  END;
END
$fn$;
--> statement-breakpoint
UPDATE agents SET
  protocols = ans_jsonb_unwrap(protocols),
  tags = ans_jsonb_unwrap(tags),
  linked_profiles = ans_jsonb_unwrap(linked_profiles),
  payment_methods = ans_jsonb_unwrap(payment_methods),
  metadata = ans_jsonb_unwrap(metadata)
WHERE jsonb_typeof(protocols) = 'string' OR jsonb_typeof(tags) = 'string' OR jsonb_typeof(linked_profiles) = 'string'
   OR jsonb_typeof(payment_methods) = 'string' OR jsonb_typeof(metadata) = 'string';
--> statement-breakpoint
UPDATE capabilities SET input_schema = ans_jsonb_unwrap(input_schema), output_schema = ans_jsonb_unwrap(output_schema)
WHERE jsonb_typeof(input_schema) = 'string' OR jsonb_typeof(output_schema) = 'string';
--> statement-breakpoint
UPDATE attestations SET claim_value = ans_jsonb_unwrap(claim_value) WHERE jsonb_typeof(claim_value) = 'string';
--> statement-breakpoint
UPDATE notifications SET payload = ans_jsonb_unwrap(payload) WHERE jsonb_typeof(payload) = 'string';
--> statement-breakpoint
UPDATE webhooks SET events = ans_jsonb_unwrap(events) WHERE jsonb_typeof(events) = 'string';
--> statement-breakpoint
UPDATE webhook_deliveries SET payload = ans_jsonb_unwrap(payload) WHERE jsonb_typeof(payload) = 'string';
--> statement-breakpoint
-- Tags must be arrays before capability ids are merged into them
UPDATE agents SET tags = '[]'::jsonb WHERE tags IS NULL OR jsonb_typeof(tags) <> 'array';
--> statement-breakpoint
-- Capabilities -> tags (14.10): copy each agent's capability ids into agents.tags, then drop the junction table.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_capabilities') THEN
    UPDATE agents SET tags = (
      SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM (
        SELECT jsonb_array_elements_text(COALESCE(agents.tags, '[]'::jsonb)) AS x
        UNION
        SELECT ac.capability_id FROM agent_capabilities ac WHERE ac.agent_id = agents.id
      ) s
    )
    WHERE EXISTS (SELECT 1 FROM agent_capabilities ac WHERE ac.agent_id = agents.id);
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_capabilities";
--> statement-breakpoint
-- Seed rows (14.19): the vendor-impersonating rows created by the original seed script
-- (exact name and operator pairs) are marked is_seed so they are excluded from ranking and
-- leaderboards until the founder deletes them. Real registrations, including Good Will, are untouched.
UPDATE agents SET is_seed = true
WHERE is_seed = false
  AND id <> 'ag_0QsEpQdgMo6bJrEF'
  AND (
    metadata->>'seed' = 'true'
    OR (name, coalesce(operator_name, '')) IN (
      ('Claude', 'Anthropic'), ('GPT-4', 'OpenAI'), ('Gemini', 'Google DeepMind'), ('Devin', 'Cognition Labs'),
      ('Operator', 'OpenAI'), ('Perplexity', 'Perplexity AI'), ('Midjourney', 'Midjourney Inc'),
      ('ElevenLabs', 'ElevenLabs'), ('Cursor', 'Anysphere')
    )
  );
