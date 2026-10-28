import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { getWork, listVersions } from "@/lib/services/lyrics";
import { VersionForm } from "./version-form";

export const metadata: Metadata = { title: "Edit lyrics" };

export default async function EditLyricPage(props: PageProps<"/lyrics/[workId]/edit">) {
  const { workId } = await props.params;
  const { ctx } = await requireAppContext();
  const { work, project, role } = await orNotFound(getWork(db, ctx, workId));
  if (role === "viewer" || project.archivedAt || work.status !== "draft") notFound();
  const [latest] = await listVersions(db, ctx, workId);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={latest ? `Edit “${work.title}”` : `Add lyrics to “${work.title}”`}
        description={
          latest
            ? `Saving records version ${latest.version.versionNo + 1}. Version ${latest.version.versionNo} stays exactly as it is.`
            : "Saving records version 1."
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={`/lyrics/${work.id}`}>Cancel</Link>
          </Button>
        }
      />
      <VersionForm workId={work.id} baseVersionNo={latest?.version.versionNo ?? 0} body={latest?.version.body ?? ""} />
    </div>
  );
}
