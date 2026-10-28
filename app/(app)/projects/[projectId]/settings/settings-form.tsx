"use client";

import { Archive, ArchiveRestore, Bot, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { PendingApprovalNotice } from "@/components/pending-approval-notice";
import { ProjectFormFields } from "@/components/project-form-fields";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApprovalRow } from "@/lib/services/approvals";
import { disableLlmOnLyricsAction, unarchiveProjectAction, updateProjectAction } from "../../actions";

type Project = {
  id: string;
  name: string;
  type: string;
  artistName: string | null;
  description: string | null;
  archived: boolean;
  allowLlmOnLyrics: boolean;
};

export function ProjectSettingsForm({
  project,
  pending: pendingRequests,
  pendingArchive,
  pendingLlm,
}: {
  project: Project;
  pending: ApprovalRow[];
  pendingArchive: boolean;
  pendingLlm: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid max-w-2xl gap-6">
      <PendingApprovalNotice rows={pendingRequests} />
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
          <CardTitle className="flex items-center gap-2">
            <Bot className="size-4" /> AI access to lyrics
            <Badge variant={project.allowLlmOnLyrics ? "default" : "outline"} data-testid="llm-lyrics-status">
              {project.allowLlmOnLyrics ? "On" : "Off"}
            </Badge>
          </CardTitle>
          <CardDescription>
            When on, AI assistants may read this project&apos;s lyrics to answer questions or suggest edits. Turning it on needs a
            workspace owner&apos;s approval; turning it off takes effect immediately.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          {project.allowLlmOnLyrics ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await disableLlmOnLyricsAction(project.id);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                })
              }
            >
              Turn off
            </Button>
          ) : (
            <RequestApprovalButton
              actionType="project.allow_llm_on_lyrics"
              payload={{ projectId: project.id }}
              variant="outline"
              disabled={pendingLlm}
              title="Request AI access to lyrics"
              description="A workspace owner has to approve letting AI models read the lyrics in this project."
            >
              {pendingLlm ? "Approval requested" : "Request to turn on"}
            </RequestApprovalButton>
          )}
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{project.archived ? "Restore project" : "Archive project"}</CardTitle>
          <CardDescription>
            {project.archived
              ? "Make the project active again."
              : "Archived projects are hidden from dashboards. Nothing is deleted and the audit trail is kept. Archiving needs a workspace owner's approval."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          {project.archived ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await unarchiveProjectAction(project.id);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.error);
                })
              }
            >
              <ArchiveRestore /> Restore
            </Button>
          ) : (
            <RequestApprovalButton
              actionType="project.archive"
              payload={{ projectId: project.id }}
              variant="destructive"
              disabled={pendingArchive}
              title={`Request to archive ${project.name}`}
              description="A workspace owner has to approve archiving a project."
            >
              <Archive /> {pendingArchive ? "Archive requested" : "Request archive"}
            </RequestApprovalButton>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
