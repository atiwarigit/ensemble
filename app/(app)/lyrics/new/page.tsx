import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { listProjects } from "@/lib/services/projects";
import { NewLyricForm } from "./new-lyric-form";

export const metadata: Metadata = { title: "New lyric" };

export default async function NewLyricPage(props: PageProps<"/lyrics/new">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const projects = (await listProjects(db, ctx)).filter(
    (p) => !p.archivedAt && (ctx.workspaceRole === "owner" || p.myRole === "lead" || p.myRole === "editor"),
  );
  if (!projects.length) notFound();
  const preselected = typeof sp.project === "string" && projects.some((p) => p.id === sp.project) ? sp.project : projects[0].id;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New lyric"
        description="Ensemble records the moment you save, from its own clock, and a fingerprint (SHA-256) of the exact text."
      />
      <NewLyricForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} defaultProjectId={preselected} />
    </div>
  );
}
