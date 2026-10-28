import type { ActorType } from "@/db/schema/audit";
import type { WorkspaceRole } from "@/db/schema/tenancy";

/** Identity and request metadata every service call runs under. Built by lib/authz for the UI and by the agent layer later. */
export type ServiceContext = {
  userId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole;
  actorType: ActorType;
  agentId?: string | null;
  onBehalfOfUserId?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: "forbidden" | "not_found" | "invalid" | "conflict",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const forbidden = (message = "You don't have permission to do that.") => new ServiceError(message, "forbidden");
export const notFound = (message = "Not found.") => new ServiceError(message, "not_found");
export const invalid = (message: string) => new ServiceError(message, "invalid");
export const conflict = (message: string) => new ServiceError(message, "conflict");
