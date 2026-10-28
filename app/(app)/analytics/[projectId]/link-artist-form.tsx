"use client";

import { Loader2, Search, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveArtistAction } from "../actions";

export function LinkArtistForm({ projectId, projectName, hasPendingRequest }: { projectId: string; projectName: string; hasPendingRequest: boolean }) {
  const [input, setInput] = useState("");
  const [found, setFound] = useState<{ spotifyArtistId: string; name: string; verified: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  if (hasPendingRequest) {
    return <p className="text-sm text-muted-foreground">A request to link an artist is waiting for an owner&apos;s approval.</p>;
  }
  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const r = await resolveArtistAction(projectId, input);
            if (!r.ok) return void toast.error(r.error);
            setFound({ ...r.data!, name: r.data!.name ?? "" });
          });
        }}
      >
        <div className="grid flex-1 gap-2">
          <Label htmlFor="artist-url">Spotify artist link</Label>
          <Input
            id="artist-url"
            placeholder="https://open.spotify.com/artist/…"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFound(null);
            }}
            className="min-w-72"
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />} Check
        </Button>
      </form>
      {found && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3" data-testid="artist-found">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="artist-name">{found.verified ? "Spotify found" : "Artist name (Spotify isn't connected, so it can't be checked)"}</Label>
            <Input
              id="artist-name"
              value={found.name}
              readOnly={found.verified}
              onChange={(e) => setFound({ ...found, name: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">ID {found.spotifyArtistId}</p>
          </div>
          <RequestApprovalButton
            actionType="spotify.connect"
            payload={{ projectId, spotifyArtistId: found.spotifyArtistId, name: found.name }}
            disabled={!found.name.trim()}
            title={`Link ${found.name || "this artist"} to ${projectName}`}
            description="A workspace owner approves new Spotify links. Once linked, the daily snapshot records the artist's releases and tracks (with ISRCs) and, when Spotify shares them, followers and popularity."
            onRequested={() => {
              setFound(null);
              setInput("");
            }}
          >
            <Send /> Request link
          </RequestApprovalButton>
        </div>
      )}
    </div>
  );
}
