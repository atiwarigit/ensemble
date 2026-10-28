"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { logGenerationAction } from "../actions";

export function GenerationForm({ workId, versions }: { workId: string; versions: { id: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="grid gap-3 rounded-md border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await logGenerationAction(workId, form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          ref.current?.reset();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="generation-tool">Tool</Label>
          <Input id="generation-tool" name="tool" placeholder="Suno" maxLength={60} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="generation-version">Lyrics used</Label>
          <Select name="versionId" defaultValue="__none">
            <SelectTrigger id="generation-version" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Choose a version</SelectItem>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generation-ref">Link or ID (optional)</Label>
        <Input id="generation-ref" name="externalRef" maxLength={300} placeholder="https://suno.com/song/…" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="generation-notes">Notes (optional)</Label>
        <Textarea id="generation-notes" name="notes" rows={2} maxLength={1000} />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="justify-self-start">
        {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Log generation
      </Button>
    </form>
  );
}
