"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart } from "ai";
import { AlertTriangle, ArrowUp, Bot, CheckCircle2, CircleDashed, Loader2, ShieldAlert, TerminalSquare, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_LABEL, type ChatFormData, type ChatMetadata, type ChatUIMessage, type ToolOutput } from "@/lib/agents/chat-types";

const PROVIDER_NAME: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

const EXAMPLES = [
  "/expenses summary october",
  '/lyric history "Paper Lanterns"',
  "/lyric list missing",
  "What did we spend on generation this month, and which works still lack a final rights package?",
];

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_strong]:font-semibold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith("/") ? <Link href={href}>{children}</Link> : <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** The chat route answers errors with `{ error }` JSON, which the transport passes through as the message. */
function serverError(error: Error) {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

function ToolStep({ name, state, output, errorText }: { name: string; state: string; output?: ToolOutput; errorText?: string }) {
  const [agent, tool] = name.split("_");
  const failed = state === "output-error" || !!output?.error;
  const done = state === "output-available" || state === "output-error";
  return (
    <div className="rounded-md border bg-muted/30 p-2.5 text-sm" data-testid="agent-step" data-tool={name} data-state={failed ? "error" : done ? "done" : "running"}>
      <div className="flex flex-wrap items-center gap-2">
        {!done ? (
          <CircleDashed className="size-4 animate-spin text-muted-foreground" />
        ) : failed ? (
          <XCircle className="size-4 text-destructive" />
        ) : output?.approvalId ? (
          <ShieldAlert className="size-4 text-amber-600" />
        ) : (
          <CheckCircle2 className="size-4 text-emerald-600" />
        )}
        <Badge variant="outline">{AGENT_LABEL[agent] ?? agent} agent</Badge>
        <code className="text-xs">{tool}</code>
        {output?.approvalId && <Badge variant="secondary">Pending approval</Badge>}
      </div>
      {(output?.summary || output?.error || errorText) && (
        <p className={`mt-1.5 ${failed ? "text-destructive" : "text-muted-foreground"}`}>{output?.summary ?? output?.error ?? errorText}</p>
      )}
      {!!output?.links?.length && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {output.links.map((l) => (
            <Link key={l.href} href={l.href} className="text-xs font-medium underline underline-offset-2">
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CommandForm({ form, disabled, onSubmit }: { form: ChatFormData; disabled: boolean; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState(form.options?.[0] ?? "");
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border p-2.5"
      data-testid="command-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        onSubmit(form.field.name === "title" ? `${form.command} "${value.trim()}"` : `${form.command} ${value.trim()}`);
      }}
    >
      <label className="grid gap-1 text-xs font-medium">
        {form.field.label}
        {form.options ? (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-48 rounded-md border bg-transparent px-2 text-sm">
            {form.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(e) => setValue(e.target.value)} className="h-8 min-w-48 rounded-md border bg-transparent px-2 text-sm" />
        )}
      </label>
      <Button size="sm" type="submit" disabled={disabled}>
        Run {form.command}
      </Button>
    </form>
  );
}

function AnswerMeta({ meta }: { meta?: ChatMetadata }) {
  if (!meta?.mode) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="answer-meta" data-mode={meta.mode} data-provider={meta.provider ?? ""}>
      {meta.mode === "llm" ? <Bot className="size-3.5" /> : <TerminalSquare className="size-3.5" />}
      <span>{meta.mode === "llm" ? `${PROVIDER_NAME[meta.provider ?? ""] ?? meta.provider} · ${meta.model}` : "Commands (no AI model)"}</span>
      {!!meta.agents?.length && <span>· agents: {meta.agents.map((a) => AGENT_LABEL[a] ?? a).join(", ")}</span>}
      {meta.mode === "llm" && meta.costUsdMicros != null && <span>· est. ${(meta.costUsdMicros / 1_000_000).toFixed(4)}</span>}
    </div>
  );
}

export function ChatView({
  threadId,
  initialMessages,
  commandMode,
}: {
  threadId: string;
  initialMessages: ChatUIMessage[];
  commandMode: boolean;
}) {
  const [input, setInput] = useState("");
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id }) => ({ body: { id, message: messages[messages.length - 1] } }),
      }),
    [],
  );
  const { messages, sendMessage, status, error } = useChat<ChatUIMessage>({ id: threadId, messages: initialMessages, transport });
  const busy = status === "submitted" || status === "streaming";
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, status]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text: text.trim() });
    setInput("");
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <div className="grid gap-4" data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            <p className="mb-3">
              {commandMode ? "No AI model is configured, so chat runs commands. Try one:" : "Ask anything about expenses or lyrics, or try:"}
            </p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.slice(0, commandMode ? 3 : 4).map((e) => (
                <Button key={e} variant="outline" size="sm" className="h-auto py-1 text-left whitespace-normal" onClick={() => send(e)}>
                  {e}
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" data-testid="user-message">
              {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
            </div>
          ) : (
            <div key={m.id} className="grid gap-2" data-testid="assistant-message">
              <AnswerMeta meta={m.metadata} />
              {m.metadata?.notice && (
                <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300" data-testid="answer-notice">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {m.metadata.notice}
                </p>
              )}
              {m.parts.map((p, i) => {
                if (p.type === "text") return p.text ? <Markdown key={i} text={p.text} /> : null;
                if (p.type === "data-form") return <CommandForm key={i} form={p.data} disabled={busy} onSubmit={send} />;
                if (isToolUIPart(p)) {
                  return (
                    <ToolStep
                      key={p.toolCallId}
                      name={getToolName(p)}
                      state={p.state}
                      output={p.state === "output-available" ? (p.output as ToolOutput) : undefined}
                      errorText={p.state === "output-error" ? p.errorText : undefined}
                    />
                  );
                }
                return null;
              })}
            </div>
          ),
        )}
        {status === "submitted" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="chat-thinking">
            <Loader2 className="size-4 animate-spin" /> Working…
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {serverError(error) ?? "That message couldn't be sent. Reload the page and try again."}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="sticky bottom-4 flex items-end gap-2 rounded-lg border bg-background p-2 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          aria-label="Message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder={commandMode ? "Type /help, or e.g. “spend in october”" : "Ask about expenses or lyrics…"}
          rows={2}
          maxLength={4000}
          className="min-h-0 resize-none border-0 shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}
