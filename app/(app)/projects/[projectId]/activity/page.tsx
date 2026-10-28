import { AuditTable } from "@/components/audit-table";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { listAuditEvents } from "@/lib/services/audit";
import { getProject } from "@/lib/services/projects";

export default async function ProjectActivityPage(props: PageProps<"/projects/[projectId]/activity">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  await orNotFound(getProject(db, ctx, projectId));
  const rows = await listAuditEvents(db, ctx, { projectId, limit: 100 });
  return <AuditTable rows={rows} showProject={false} />;
}
