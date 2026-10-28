"use client";

import { Loader2, Paperclip } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addEvidenceAction } from "../actions";

const KINDS = [
  { value: "notebook_scan", label: "Notebook scan / photo" },
  { value: "voice_memo", label: "Voice memo" },
  { value: "doc", label: "Document" },
  { value: "email", label: "Email" },
];

export function EvidenceForm({ workId, versions }: { workId: string; versions: { id: string; label: string }[] }) {
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
          const r = await addEvidenceAction(workId, form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          ref.current?.reset();
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="evidence-file">File (up to 10 MB)</Label>
        <Input id="evidence-file" name="file" type="file" required />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="evidence-kind">Kind</Label>
          <Select name="kind" defaultValue="notebook_scan">
            <SelectTrigger id="evidence-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="evidence-version">For version</Label>
          <Select name="versionId" defaultValue="__none">
            <SelectTrigger id="evidence-version" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Whole work</SelectItem>
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
        <Label htmlFor="evidence-description">Description (optional)</Label>
        <Input id="evidence-description" name="description" maxLength={500} placeholder="Page from my 2019 notebook" />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="justify-self-start">
        {pending ? <Loader2 className="animate-spin" /> : <Paperclip />}
        Attach evidence
      </Button>
    </form>
  );
}
