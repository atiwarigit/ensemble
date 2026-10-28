import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { ServiceError } from "@/lib/services/context";
import { downloadPackage } from "@/lib/services/rights";

export async function GET(_request: Request, ctx: RouteContext<"/api/rights/packages/[packageId]">) {
  const { packageId } = await ctx.params;
  const app = await requireAppContext();
  try {
    const { pkg, data } = await db.transaction((tx) => downloadPackage(tx, app.ctx, packageId));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(pkg.filename)}"`,
        "X-Content-SHA256": pkg.zipSha256,
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
