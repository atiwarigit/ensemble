-- Canonical text of an audit row used for hashing. jsonb renders keys in a deterministic order.
CREATE OR REPLACE FUNCTION audit_event_canonical(e audit_events) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', e.id,
    'workspace_id', e.workspace_id,
    'project_id', e.project_id,
    'actor_type', e.actor_type,
    'actor_user_id', e.actor_user_id,
    'agent_id', e.agent_id,
    'on_behalf_of_user_id', e.on_behalf_of_user_id,
    'action', e.action,
    'entity_type', e.entity_type,
    'entity_id', e.entity_id,
    'before', e.before,
    'after', e.after,
    'request_id', e.request_id,
    'ip', e.ip,
    'user_agent', e.user_agent,
    'created_at', to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text
$$;
--> statement-breakpoint
-- Serialises inserts with a transaction-scoped advisory lock so ids, prev_hash links and
-- commit order agree. The id is re-drawn inside the lock for the same reason.
CREATE OR REPLACE FUNCTION audit_events_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_events_chain'));
  NEW.id := nextval(pg_get_serial_sequence('audit_events', 'id'));
  NEW.created_at := clock_timestamp();
  SELECT hash INTO last_hash FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.hash := encode(sha256(convert_to(coalesce(last_hash, '') || audit_event_canonical(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_chain
  BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_before_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_events_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_change();
--> statement-breakpoint
-- Walks the chain in id order. Returns one row per break; an empty result means the chain is intact.
CREATE OR REPLACE FUNCTION audit_verify_chain()
RETURNS TABLE (broken_id bigint, reason text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_events;
  expected_prev text := NULL;
  expected_hash text;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      broken_id := r.id; reason := 'prev_hash mismatch'; RETURN NEXT;
    END IF;
    expected_hash := encode(sha256(convert_to(coalesce(r.prev_hash, '') || audit_event_canonical(r), 'UTF8')), 'hex');
    IF r.hash <> expected_hash THEN
      broken_id := r.id; reason := 'hash mismatch'; RETURN NEXT;
    END IF;
    expected_prev := r.hash;
  END LOOP;
END
$$;
