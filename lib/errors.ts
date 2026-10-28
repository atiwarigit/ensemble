import { ServiceError } from "@/lib/services/context";

/** User-facing message for service and validation errors; anything else is logged and hidden. */
export function errorMessage(err: unknown) {
  if (err instanceof ServiceError) return err.message;
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    const first = (err as { issues: { message: string }[] }).issues[0];
    return first?.message ?? "Invalid input.";
  }
  console.error(err);
  return "Something went wrong. Please try again.";
}
