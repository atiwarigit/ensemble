import { checkCronAuth } from "@/lib/cron";
import { runAuditVerifyJob } from "@/lib/jobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await runAuditVerifyJob();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
