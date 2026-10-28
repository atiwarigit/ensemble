"use client";

import { Loader2, Upload } from "lucide-react";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadImportAction } from "../actions";
import type { Option } from "../data";

export function UploadForm({ projects, defaultProjectId }: { projects: Option[]; defaultProjectId?: string }) {
  const [state, action, pending] = useActionState(uploadImportAction, undefined);
  return (
    <form action={action} className="grid gap-4">
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="import-file">CSV file</Label>
          <Input id="import-file" name="file" type="file" accept=".csv,text/csv" required className="w-80" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="import-project">Assign to project</Label>
          <Select
            name="projectId"
            defaultValue={defaultProjectId && projects.some((p) => p.id === defaultProjectId) ? defaultProjectId : "personal"}
          >
            <SelectTrigger id="import-project" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="personal">Personal / unallocated</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload and preview
        </Button>
      </div>
    </form>
  );
}
