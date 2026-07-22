import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, ClarificationPayload } from "../types";
import AssumptionsCard from "./AssumptionsCard";
import ClarificationPrompt from "./ClarificationPrompt";
import FeedbackBar from "./FeedbackBar";
import ResultDisplay from "./ResultDisplay";

interface Props {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (text: string) => void;
  sampleQuestions: string[];
  pendingClarification?: ClarificationPayload | null;
  onClarificationSelect?: (optionId: string, metricId?: string) => void;
  sessionId?: string | null;
  onFeedback?: (messageId: string, verdict: import("../types").FeedbackVerdict) => void;
}

export default function ChatPanel({
  messages,
  isLoading,
  onSend,
  sampleQuestions,
  pendingClarification,
  onClarificationSelect,
  sessionId,
  onFeedback,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, pendingClarification]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (!value || isLoading) return;
    onSend(value);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
        {messages.length <= 1 && sampleQuestions.length > 0 && (
          <div className="rounded-2xl border border-dashed border-surface-600 bg-surface-900/40 p-6">
            <h3 className="text-lg font-semibold text-white">Try a sample question</h3>
            <p className="mt-1 text-sm text-slate-400">
              Ask in plain English — metric resolution, scope, and assumptions are shown live.
            </p>
            <div className="mt-4 grid gap-2">
              {sampleQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isLoading}
                  onClick={() => onSend(q)}
                  className="rounded-xl border border-surface-700 bg-surface-800/60 px-4 py-3 text-left text-sm text-slate-300 transition hover:border-accent/40 hover:bg-surface-800 hover:text-white disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[92%] rounded-2xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-accent/15 text-white ring-1 ring-accent/30"
                  : "bg-surface-800/90 text-slate-200 ring-1 ring-surface-600"
              }`}
            >
              {msg.role === "assistant" ? (
                msg.clarification ? null : (
                  <div className="markdown-body text-sm leading-relaxed">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )
              ) : (
                <p className="text-sm">{msg.content}</p>
              )}

              {msg.clarification && onClarificationSelect && (
                <ClarificationPrompt
                  clarification={msg.clarification}
                  onSelect={onClarificationSelect}
                  disabled={isLoading}
                />
              )}

              {msg.displays && msg.displays.length > 0 && (
                <div className="mt-4">
                  <ResultDisplay displays={msg.displays} />
                </div>
              )}

              {(msg.resolution || msg.sanity || msg.pendingApproval) && (
                <AssumptionsCard
                  resolution={msg.resolution}
                  sanity={msg.sanity}
                  pendingApproval={msg.pendingApproval}
                  proposalId={msg.proposalId}
                  sql={msg.sql}
                />
              )}

              {msg.pendingApproval && (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                  Queued for analyst approval
                  {msg.proposalId ? (
                    <span className="ml-1 font-mono text-xs text-amber-300/80">
                      ({msg.proposalId})
                    </span>
                  ) : null}
                  . Open the Approvals tab to verify or edit SQL before promoting to metrics.json.
                </div>
              )}

              {(msg.awaitingConfirmation || msg.feedbackSubmitted) && sessionId && (
                <FeedbackBar
                  messageId={msg.id}
                  sessionId={sessionId}
                  awaitingConfirmation={msg.awaitingConfirmation}
                  feedbackSubmitted={msg.feedbackSubmitted}
                  onFeedback={(v) => onFeedback?.(msg.id, v)}
                />
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-surface-800/90 px-4 py-3 ring-1 ring-surface-600">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-2 w-2 animate-bounce rounded-full bg-accent"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
              <span className="text-sm text-slate-400">Analyzing…</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="mt-4 shrink-0">
        <div className="flex gap-2 rounded-2xl border border-surface-700 bg-surface-900/90 p-2 ring-1 ring-surface-700 focus-within:ring-accent/40">
          <textarea
            ref={inputRef}
            rows={2}
            placeholder="Ask about sales, customers, products…"
            disabled={isLoading}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none bg-transparent px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="self-end rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-surface-950 transition hover:bg-accent-glow disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
