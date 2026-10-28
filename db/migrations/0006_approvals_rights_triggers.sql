-- Generated rights packages are records of what was exported; they're never changed or removed.
CREATE TRIGGER rights_packages_immutable
  BEFORE UPDATE OR DELETE ON rights_packages
  FOR EACH ROW EXECUTE FUNCTION authorship_reject_change();
--> statement-breakpoint
-- Approval requests move pending -> approved -> executed/failed, or pending -> rejected/expired.
-- Once decided they can't be edited, and they're never deleted.
CREATE OR REPLACE FUNCTION approval_requests_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval_requests rows can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'approval request % is already %', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.action_type IS DISTINCT FROM OLD.action_type OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'approval request payloads are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER approval_requests_guard
  BEFORE UPDATE OR DELETE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION approval_requests_guard();
