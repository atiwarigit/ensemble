-- An AI suggestion's text and provenance never change; it can be decided once (accepted or dismissed).
CREATE OR REPLACE FUNCTION lyric_suggestions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lyric_suggestions rows can''t be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'suggestion % is already %', OLD.id, OLD.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.suggestion IS DISTINCT FROM OLD.suggestion OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model OR NEW.base_version_id IS DISTINCT FROM OLD.base_version_id
     OR NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'suggestion text and provenance are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lyric_suggestions_guard
  BEFORE UPDATE OR DELETE ON lyric_suggestions
  FOR EACH ROW EXECUTE FUNCTION lyric_suggestions_guard();
--> statement-breakpoint
-- The LLM call log backs the budget, so rows can't be edited or removed.
CREATE TRIGGER llm_calls_immutable
  BEFORE UPDATE OR DELETE ON llm_calls
  FOR EACH ROW EXECUTE FUNCTION authorship_reject_change();
