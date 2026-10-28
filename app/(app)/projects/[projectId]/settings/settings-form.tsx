"use client";

import { Archive, ArchiveRestore, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { ProjectFormFields } from "@/components/project-form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { setArchivedAction, updateProjectAction } from "../../actions";

type Project = {
  id: string;
  name: string;
  type: string;
  artistName: string | null;
  description: string | null;
  archived: boolean;
};

export function ProjectSettingsForm({ project }: { project: Project }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <form
          action={(form) =>
            startTransition(async () => {
              const r = await updateProjectAction(project.id, form);
              if (r.ok) toast.success(r.message);
              else toast.error(r.error);
            })
          }
        >
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            <ProjectFormFields defaults={project} />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{project.archived ? "Restore project" : "Archive project"}</CardTitle>
          <CardDescription>
            {project.archived
              ? "Make the project active again."
              : "Archived projects are hidden from dashboards. Nothing is deleted and the audit trail is kept."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant={project.archived ? "outline" : "destructive"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await setArchivedAction(project.id, !project.archived);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })
            }
          >
            {project.archived ? <ArchiveRestore /> : <Archive />}
            {project.archived ? "Restore" : "Archive"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
