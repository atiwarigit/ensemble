"use client";

import { Loader2, Upload } from "lucide-react";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadS4aAction } from "../actions";

export function S4aUploadForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(uploadS4aAction.bind(null, projectId), undefined);
  return (
    <form action={action} className="grid gap-3">
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="s4a-file">Spotify for Artists CSV</Label>
          <Input id="s4a-file" name="file" type="file" accept=".csv,text/csv" required className="w-80" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload and preview
        </Button>
      </div>
    </form>
  );
}
