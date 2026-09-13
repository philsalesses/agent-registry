CREATE TABLE IF NOT EXISTS "registry_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM receipts GROUP BY initiator_id, open_nonce HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "receipts_initiator_nonce_idx" ON "receipts" ("initiator_id","open_nonce");
  END IF;
END $$;
--> statement-breakpoint
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
-- Unwrap any jsonb written double-encoded before the driver fix (idempotent)
UPDATE agents SET
  protocols = ans_jsonb_unwrap(protocols),
  tags = ans_jsonb_unwrap(tags),
  linked_profiles = ans_jsonb_unwrap(linked_profiles),
  payment_methods = ans_jsonb_unwrap(payment_methods),
  metadata = ans_jsonb_unwrap(metadata),
  receipt_counts = ans_jsonb_unwrap(receipt_counts),
  policy = ans_jsonb_unwrap(policy)
WHERE jsonb_typeof(protocols) = 'string' OR jsonb_typeof(tags) = 'string' OR jsonb_typeof(linked_profiles) = 'string'
   OR jsonb_typeof(payment_methods) = 'string' OR jsonb_typeof(metadata) = 'string'
   OR jsonb_typeof(receipt_counts) = 'string' OR jsonb_typeof(policy) = 'string';
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
UPDATE offers SET
  input_schema = ans_jsonb_unwrap(input_schema),
  output_schema = ans_jsonb_unwrap(output_schema),
  examples = ans_jsonb_unwrap(examples),
  tags = ans_jsonb_unwrap(tags),
  stats = ans_jsonb_unwrap(stats),
  requires = ans_jsonb_unwrap(requires),
  feeds = ans_jsonb_unwrap(feeds)
WHERE jsonb_typeof(input_schema) = 'string' OR jsonb_typeof(output_schema) = 'string' OR jsonb_typeof(examples) = 'string'
   OR jsonb_typeof(tags) = 'string' OR jsonb_typeof(stats) = 'string' OR jsonb_typeof(requires) = 'string' OR jsonb_typeof(feeds) = 'string';
--> statement-breakpoint
UPDATE receipts SET counterparty_hint = ans_jsonb_unwrap(counterparty_hint), sig_material = ans_jsonb_unwrap(sig_material)
WHERE jsonb_typeof(counterparty_hint) = 'string' OR jsonb_typeof(sig_material) = 'string';
--> statement-breakpoint
UPDATE receipt_events SET payload = ans_jsonb_unwrap(payload) WHERE jsonb_typeof(payload) = 'string';
--> statement-breakpoint
UPDATE ratings SET tags = ans_jsonb_unwrap(tags) WHERE jsonb_typeof(tags) = 'string';
--> statement-breakpoint
UPDATE api_keys SET scopes = ans_jsonb_unwrap(scopes) WHERE jsonb_typeof(scopes) = 'string';
--> statement-breakpoint
UPDATE idempotency_keys SET response = ans_jsonb_unwrap(response) WHERE jsonb_typeof(response) = 'string';
--> statement-breakpoint
UPDATE system_flags SET value = ans_jsonb_unwrap(value) WHERE jsonb_typeof(value) = 'string';
--> statement-breakpoint
-- The founder's agent gets its handle
UPDATE agents SET handle = 'goodwill'
WHERE id = 'ag_0QsEpQdgMo6bJrEF' AND handle IS NULL AND NOT EXISTS (SELECT 1 FROM agents WHERE handle = 'goodwill');
