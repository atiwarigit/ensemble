"use client";

import { Loader2, Save } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { S4aConfig } from "@/db/schema/expenses";
import { DATE_FORMATS } from "@/lib/csv/expenses-csv";
import { S4A_METRIC_LABEL, S4A_METRICS } from "@/lib/csv/s4a-csv";
import { updateS4aConfigAction } from "../../../actions";

function ColumnSelect({ name, label, headers, value }: { name: string; label: string; headers: string[]; value: string | null | undefined }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={`col-${name}`}>{label}</Label>
      <Select name={name} defaultValue={value ?? "__none"}>
        <SelectTrigger id={`col-${name}`} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">—</SelectItem>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function S4aMappingForm({
  projectId,
  batchId,
  headers,
  config,
  tracks,
}: {
  projectId: string;
  batchId: string;
  headers: string[];
  config: S4aConfig;
  tracks: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-4"
      action={(form) =>
        startTransition(async () => {
          const r = await updateS4aConfigAction(projectId, batchId, form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
        })
      }
    >
      <div className="flex flex-wrap gap-4">
        <ColumnSelect name="dateColumn" label="Date column" headers={headers} value={config.dateColumn} />
        <div className="grid gap-1.5">
          <Label htmlFor="s4a-date-format">Date format</Label>
          <Select name="dateFormat" defaultValue={config.dateFormat}>
            <SelectTrigger id="s4a-date-format" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="s4a-fixed-date">Or: period ends on</Label>
          <Input id="s4a-fixed-date" name="fixedDate" type="date" defaultValue={config.fixedDate ?? ""} className="w-44" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        {S4A_METRICS.map((m) => (
          <ColumnSelect key={m} name={`metric_${m}`} label={S4A_METRIC_LABEL[m]} headers={headers} value={config.metrics[m]} />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <ColumnSelect name="trackColumn" label="Song column (title, ISRC or URI)" headers={headers} value={config.trackColumn} />
        <div className="grid gap-1.5">
          <Label htmlFor="s4a-fixed-track">Or: the whole file is one song</Label>
          <Select name="fixedTrackId" defaultValue={config.fixedTrackId ?? "__none"}>
            <SelectTrigger id="s4a-fixed-track" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">— (artist totals)</SelectItem>
              {tracks.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Update preview
        </Button>
      </div>
    </form>
  );
}
