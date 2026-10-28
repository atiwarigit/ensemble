import type { Version } from "@/lib/services/lyrics";

export const ORIGIN_LABEL: Record<Version["origin"], string> = {
  human: "Human-written",
  human_edit_of_ai_suggestion: "Human edit of an AI suggestion",
  imported_original: "Older original, entered",
};

export const ROLE_LABEL = { lyricist: "Lyricist", "co-writer": "Co-writer", editor: "Editor" } as const;
