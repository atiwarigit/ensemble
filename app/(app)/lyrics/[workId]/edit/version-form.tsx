"use client";

import { Loader2 } from "lucide-react";
import { useState, useSyncExternalStore, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addVersionAction, type FormState } from "../../actions";

const noop = () => () => {};

export function VersionForm({ workId, baseVersionNo, body }: { workId: string; baseVersionNo: number; body: string }) {
  const [state, setState] = useState<FormState>();
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  // Typing before hydration can merge with the server-rendered text; don't allow saving until then.
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(async () => setState(await addVersionAction(workId, undefined, form)));
      }}
    >
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <input type="hidden" name="baseVersionNo" value={baseVersionNo} />
      <div className="grid gap-2">
        <Label htmlFor="version-body">Lyrics</Label>
        <Textarea id="version-body" name="body" rows={18} defaultValue={body} className="font-mono text-sm" required />
      </div>
      {baseVersionNo === 0 && (
        <div className="grid gap-2 sm:max-w-xs">
          <Label htmlFor="version-claimed">Date written (optional)</Label>
          <Input id="version-claimed" name="claimedWrittenAt" type="date" max={today} />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="version-note">What changed? (optional)</Label>
        <Input id="version-note" name="changeNote" maxLength={500} placeholder="Rewrote the second verse" />
      </div>
      <div>
        <Button type="submit" disabled={pending || !hydrated}>
          {pending && <Loader2 className="animate-spin" />}
          Save version {baseVersionNo + 1}
        </Button>
      </div>
    </form>
  );
}
