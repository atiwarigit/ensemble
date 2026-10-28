import { Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { getProject } from "@/lib/services/projects";
import { ProjectTabs } from "./tabs";

export default async function ProjectLayout(props: LayoutProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  const { project, role } = await orNotFound(getProject(db, ctx, projectId));

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {project.name}
            {project.archivedAt && <Badge variant="outline">Archived</Badge>}
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Lock className="size-3.5" /> Private
            <span>·</span>
            <span className="capitalize">{project.type}</span>
            {project.artistName && (
              <>
                <span>·</span>
                {project.artistName}
              </>
            )}
            <span>·</span>
            <span>
              Your access: <span className="capitalize">{role}</span>
            </span>
          </span>
        }
      />
      <ProjectTabs projectId={project.id} canManage={role === "lead"} />
      <div className="mt-6">{props.children}</div>
    </>
  );
}
