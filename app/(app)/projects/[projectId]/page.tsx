import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getProject, listAddableMembers, listProjectMembers } from "@/lib/services/projects";
import { MembersPanel } from "./members-panel";

export default async function ProjectOverviewPage(props: PageProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  const { project, role } = await orNotFound(getProject(db, ctx, projectId));
  const canManage = role === "lead";
  const [members, addable] = await Promise.all([
    listProjectMembers(db, ctx, projectId),
    canManage ? listAddableMembers(db, ctx, projectId) : Promise.resolve([]),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Only these people and workspace owners can see this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <MembersPanel
            projectId={projectId}
            members={members.map((m) => ({ ...m, addedAt: m.addedAt.toISOString() }))}
            addable={addable}
            canManage={canManage}
            currentUserId={ctx.userId}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {project.description || "No description yet."}
        </CardContent>
      </Card>
    </div>
  );
}
