-- Authorship records are append-only. The database, not the app, sets the recorded time and the
-- content hash, so neither can be backdated or mislabelled by application code.
CREATE OR REPLACE FUNCTION lyric_versions_before_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_at := clock_timestamp();
  NEW.content_sha256 := encode(sha256(convert_to(NEW.body, 'UTF8')), 'hex');
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER lyric_versions_stamp
  BEFORE INSERT ON lyric_versions
  FOR EACH ROW EXECUTE FUNCTION lyric_versions_before_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION authorship_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER lyric_versions_immutable
  BEFORE UPDATE OR DELETE ON lyric_versions
  FOR EACH ROW EXECUTE FUNCTION authorship_reject_change();
--> statement-breakpoint
CREATE TRIGGER lyric_versions_no_truncate
  BEFORE TRUNCATE ON lyric_versions
  FOR EACH STATEMENT EXECUTE FUNCTION authorship_reject_change();
--> statement-breakpoint
CREATE TRIGGER lyric_evidence_immutable
  BEFORE UPDATE OR DELETE ON lyric_evidence
  FOR EACH ROW EXECUTE FUNCTION authorship_reject_change();
--> statement-breakpoint
CREATE TRIGGER generation_links_immutable
  BEFORE UPDATE OR DELETE ON generation_links
  FOR EACH ROW EXECUTE FUNCTION authorship_reject_change();
--> statement-breakpoint
CREATE TRIGGER stored_files_immutable
  BEFORE UPDATE ON stored_files
  FOR EACH ROW EXECUTE FUNCTION authorship_reject_change();
