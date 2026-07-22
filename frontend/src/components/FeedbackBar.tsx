import { useState } from "react";
import { submitFeedback } from "../api/client";
import type { FeedbackVerdict } from "../types";

interface Props {
  messageId: string;
  sessionId: string | null;
  awaitingConfirmation?: boolean;
  feedbackSubmitted?: FeedbackVerdict | null;
  onFeedback?: (verdict: FeedbackVerdict) => void;
}

export default function FeedbackBar({
  messageId,
  sessionId,
  awaitingConfirmation,
  feedbackSubmitted,
  onFeedback,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!awaitingConfirmation && !feedbackSubmitted) return null;

  const handle = async (verdict: FeedbackVerdict) => {
    if (!sessionId || feedbackSubmitted) return;
    setLoading(true);
    try {
      const res = await submitFeedback(sessionId, messageId, verdict);
      setMessage(res.message || (res.cached ? "Cached for 14 days." : "Feedback recorded."));
      onFeedback?.(verdict);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (feedbackSubmitted) {
    return (
      <div className="mt-2 rounded-lg bg-surface-800/80 px-3 py-2 text-xs text-slate-400">
        Feedback: <span className="text-slate-200">{feedbackSubmitted.replace("_", " ")}</span>
        {message && <span className="ml-2 text-emerald-300">{message}</span>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-surface-600 bg-surface-900/50 p-3">
      <p className="mb-2 text-xs text-slate-400">Does this data look correct?</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => handle("correct")}
          className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50"
        >
          Looks correct
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => handle("wrong_metric")}
          className="rounded-lg bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/25 disabled:opacity-50"
        >
          Wrong metric
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => handle("wrong_scope")}
          className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50"
        >
          Wrong scope
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-slate-400">{message}</p>}
    </div>
  );
}
