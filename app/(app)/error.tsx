"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center" role="alert">
      <TriangleAlert className="size-8 text-destructive" />
      <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
      <p className="text-sm text-muted-foreground">
        Nothing was changed. Try again; if it keeps happening, send the reference below to whoever runs this workspace.
      </p>
      {error.digest && <code className="rounded bg-muted px-2 py-1 text-xs">Reference {error.digest}</code>}
      <Button onClick={reset}>
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
