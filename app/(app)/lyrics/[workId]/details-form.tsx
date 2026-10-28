"use client";

import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateWorkAction } from "../actions";

export function DetailsForm({
  workId,
  editable,
  titleLocked,
  values,
}: {
  workId: string;
  editable: boolean;
  titleLocked: boolean;
  values: { title: string; isrc: string; iswc: string };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await updateWorkAction(workId, form);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="work-title">Title</Label>
        <Input id="work-title" name="title" defaultValue={values.title} readOnly={!editable || titleLocked} required />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="work-isrc">ISRC</Label>
          <Input id="work-isrc" name="isrc" defaultValue={values.isrc} readOnly={!editable} placeholder="USRC17607839" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="work-iswc">ISWC</Label>
          <Input id="work-iswc" name="iswc" defaultValue={values.iswc} readOnly={!editable} placeholder="T0345246801" />
        </div>
      </div>
      {editable && (
        <Button type="submit" size="sm" variant="outline" disabled={pending} className="justify-self-start">
          {pending && <Loader2 className="animate-spin" />}
          Save details
        </Button>
      )}
    </form>
  );
}
