import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { requireProjectRole } from "@/lib/services/access";
import { listApprovals } from "@/lib/services/approvals";
import { ProjectSettingsForm } from "./settings-form";

export default async function ProjectSettingsPage(props: PageProps<"/projects/[projectId]/settings">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  const { project } = await orNotFound(requireProjectRole(db, ctx, projectId, "lead"));
  const pending = await listApprovals(db, ctx, { scope: "pending", entityType: "project", entityId: projectId });
  return (
    <ProjectSettingsForm
      pending={pending}
      pendingArchive={pending.some((r) => r.req.actionType === "project.archive")}
      pendingLlm={pending.some((r) => r.req.actionType === "project.allow_llm_on_lyrics")}
      project={{
        id: project.id,
        name: project.name,
        type: project.type,
        artistName: project.artistName,
        description: project.description,
        archived: project.archivedAt !== null,
        allowLlmOnLyrics: project.settings.allow_llm_on_lyrics ?? false,
      }}
    />
  );
}
