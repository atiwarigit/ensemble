"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createWorkAction, type FormState } from "../actions";

export function NewLyricForm({ projects, defaultProjectId }: { projects: { id: string; name: string }[]; defaultProjectId: string }) {
  const [state, setState] = useState<FormState>();
  const [pending, startTransition] = useTransition();
  const [origin, setOrigin] = useState<"human" | "imported_original">("human");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(async () => setState(await createWorkAction(undefined, form)));
      }}
    >
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="lyric-project">Project</Label>
          <Select name="projectId" defaultValue={defaultProjectId}>
            <SelectTrigger id="lyric-project" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="lyric-title">Title</Label>
          <Input id="lyric-title" name="title" required maxLength={200} />
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">What are you entering?</legend>
        <input type="hidden" name="origin" value={origin} />
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { value: "human", title: "New writing", hint: "Lyrics you're writing now." },
              { value: "imported_original", title: "An older poem or lyric", hint: "Something you wrote before. Add the date you wrote it." },
            ] as const
          ).map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-checked:border-primary has-checked:bg-muted/50"
            >
              <input
                type="radio"
                name="originChoice"
                value={o.value}
                checked={origin === o.value}
                onChange={() => setOrigin(o.value)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{o.title}</span>
                <span className="text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="lyric-claimed">
          Date written {origin === "human" && <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Input id="lyric-claimed" name="claimedWrittenAt" type="date" max={today} required={origin === "imported_original"} />
        <p className="text-xs text-muted-foreground">Shown as &ldquo;stated by the author&rdquo;. Ensemble can only prove when it recorded the text.</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="lyric-body">
          Lyrics {origin === "human" && <span className="font-normal text-muted-foreground">(you can add them later)</span>}
        </Label>
        <Textarea
          id="lyric-body"
          name="body"
          rows={14}
          className="font-mono text-sm"
          required={origin === "imported_original"}
          placeholder={"Verse 1\n..."}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="lyric-note">Note for this version (optional)</Label>
        <Input id="lyric-note" name="changeNote" maxLength={500} placeholder="First draft" />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save lyric
        </Button>
      </div>
    </form>
  );
}
