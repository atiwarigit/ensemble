import { requireAppContext } from "@/lib/authz";
import { ServiceError } from "@/lib/services/context";
import { downloadEvidence } from "@/lib/services/lyrics";

export async function GET(_request: Request, ctx: RouteContext<"/api/lyrics/evidence/[evidenceId]">) {
  const { evidenceId } = await ctx.params;
  const app = await requireAppContext();
  try {
    const { evidence, data } = await downloadEvidence(app.ctx, evidenceId);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": evidence.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(evidence.filename)}"; filename*=UTF-8''${encodeURIComponent(evidence.filename)}`,
        "X-Content-SHA256": evidence.sha256,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError && (err.code === "not_found" || err.code === "forbidden")) {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }
}
