import { Bot, TerminalSquare } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PROVIDER_LABEL, type ProviderPlan } from "@/lib/llm/providers";

const OFF_REASON: Record<Exclude<ProviderPlan["reason"], "ok">, string> = {
  no_keys: "No ANTHROPIC_API_KEY or OPENAI_API_KEY is set on the server.",
  env_off: "LLM_PROVIDER=none is set on the server.",
  workspace_off: "An owner turned the AI assistant off in Settings → AI assistant.",
};

export function AssistantStatus({ plan, overBudget }: { plan: ProviderPlan; overBudget: boolean }) {
  if (plan.reason !== "ok") {
    return (
      <Alert className="mb-4" data-testid="assistant-status" data-mode="commands">
        <TerminalSquare />
        <AlertTitle>{plan.reason === "no_keys" ? "AI assistant not configured" : "AI assistant turned off"} — using commands</AlertTitle>
        <AlertDescription>
          {OFF_REASON[plan.reason]} Chat still works: type <code>/help</code> for commands, or ask in plain words like “spend in
          october”.
        </AlertDescription>
      </Alert>
    );
  }
  const [primary, fallback] = plan.order;
  return (
    <Alert className="mb-4" data-testid="assistant-status" data-mode="llm" data-provider={primary.id}>
      <Bot />
      <AlertTitle>
        AI assistant: {PROVIDER_LABEL[primary.id]} ({primary.model})
      </AlertTitle>
      <AlertDescription>
        {fallback ? `Falls back to ${PROVIDER_LABEL[fallback.id]} if ${PROVIDER_LABEL[primary.id]} is down. ` : "No fallback provider configured. "}
        {overBudget ? (
          <>
            This month&apos;s budget is used up, so answers come from commands until an owner{" "}
            <Link href="/settings/ai" className="underline">
              raises it
            </Link>
            .
          </>
        ) : (
          "Slash commands (/help) always run without a model."
        )}
      </AlertDescription>
    </Alert>
  );
}
