import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { requireProjectRole } from "@/lib/services/access";
import { ProjectSettingsForm } from "./settings-form";

export default async function ProjectSettingsPage(props: PageProps<"/projects/[projectId]/settings">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  const { project } = await orNotFound(requireProjectRole(db, ctx, projectId, "lead"));
  return (
    <ProjectSettingsForm
      project={{
        id: project.id,
        name: project.name,
        type: project.type,
        artistName: project.artistName,
        description: project.description,
        archived: project.archivedAt !== null,
      }}
    />
  );
}
