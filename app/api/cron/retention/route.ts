import { checkCronAuth } from "@/lib/cron";
import { runRetentionJob } from "@/lib/jobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await runRetentionJob();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
