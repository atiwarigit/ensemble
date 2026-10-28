"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/authz";
import { decideApproval, requestApproval, type ApprovalActionType } from "@/lib/services/approvals";

export async function requestApprovalAction(actionType: ApprovalActionType, payload: unknown, reason?: string) {
  const result = await runAction(async ({ ctx }) => {
    // The registry validates the payload against the action's schema before anything is stored.
    const req = await requestApproval(ctx, actionType, payload as never, reason);
    return { id: req.id };
  }, "Request sent for approval.");
  revalidatePath("/", "layout");
  return result;
}

export async function decideApprovalAction(requestId: string, decision: "approve" | "reject", note?: string) {
  const result = await runAction(async ({ ctx }) => {
    const r = await decideApproval(ctx, requestId, { decision, note });
    return { status: r.status, error: r.error };
  });
  revalidatePath("/", "layout");
  if (!result.ok) return result;
  const { status, error } = result.data!;
  if (status === "failed") return { ok: false as const, error: `Approved, but it couldn't be carried out: ${error}` };
  return {
    ...result,
    message: status === "executed" ? "Approved and done." : status === "rejected" ? "Request rejected." : `Request ${status}.`,
  };
}
