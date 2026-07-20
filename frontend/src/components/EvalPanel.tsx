import { useMemo, useState } from "react";
import { fetchEvalCases, streamEvalRun } from "../api/client";
import type { EvalCase, EvalCaseResult, EvalCaseStatus, StreamEvent } from "../types";

const DEMO_TIPS = [
  "Pass = agent SQL returns the same result set as the gold query (execution accuracy).",
  "Expand a case to compare agent SQL vs gold SQL and discuss misses in class.",
  "Re-run after editing metadata rules to show how context changes scores.",
];

const statusStyles: Record<EvalCaseStatus, string> = {
  pending: "bg-surface-700/60 text-slate-400 ring-surface-600",
  running: "bg-accent/15 text-accent-glow ring-accent/40",
  passed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 ring-red-500/30",
  error: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
};

interface RowState extends EvalCase {
  status: EvalCaseStatus;
  detail?: string;
  agent_sql?: string | null;
  gold_rows?: number | null;
  agent_rows?: number | null;
}

interface Props {
  cases: EvalCase[];
  onCasesLoaded: (cases: EvalCase[]) => void;
}

export default function EvalPanel({ cases, onCasesLoaded }: Props) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    passed: number;
    failed: number;
    total: number;
  } | null>(null);

  const displayRows: RowState[] = useMemo(() => {
    if (rows.length > 0) return rows;
    return cases.map((c) => ({
      ...c,
      status: "pending" as const,
      detail: undefined,
      agent_sql: undefined,
      gold_rows: undefined,
      agent_rows: undefined,
    }));
  }, [rows, cases]);

  const scoreboard = useMemo(() => {
    if (summary) return summary;
    const passed = displayRows.filter((r) => r.status === "passed").length;
    const failed = displayRows.filter(
      (r) => r.status === "failed" || r.status === "error",
    ).length;
    return { passed, failed, total: displayRows.length };
  }, [summary, displayRows]);

  const ensureCases = async (): Promise<EvalCase[]> => {
    if (cases.length > 0) return cases;
    const loaded = await fetchEvalCases();
    onCasesLoaded(loaded);
    return loaded;
  };

  const handleRun = async () => {
    setError(null);
    setSummary(null);
    setRunning(true);
    try {
      const loaded = await ensureCases();
      setRows(
        loaded.map((c) => ({
          ...c,
          status: "pending",
          detail: undefined,
          agent_sql: undefined,
        })),
      );

      streamEvalRun({
        onEvent: (event: StreamEvent) => {
          if (event.type === "eval_start" && event.total != null) {
            setSummary({ passed: 0, failed: 0, total: event.total });
          }
          if (event.type === "case_start" && event.id) {
            setRows((prev) =>
              prev.map((r) =>
                r.id === event.id
                  ? { ...r, status: "running", detail: "Running agent…" }
                  : r,
              ),
            );
          }
          if (event.type === "case_result" && event.id) {
            const result = event as StreamEvent & Partial<EvalCaseResult>;
            setRows((prev) =>
              prev.map((r) =>
                r.id === event.id
                  ? {
                      ...r,
                      status: (result.status as EvalCaseStatus) || "failed",
                      detail: result.detail || "",
                      agent_sql: result.agent_sql,
                      gold_sql: result.gold_sql || r.gold_sql,
                      gold_rows: result.gold_rows,
                      agent_rows: result.agent_rows,
                      notes: result.notes || r.notes,
                    }
                  : r,
              ),
            );
          }
          if (event.type === "eval_done") {
            setSummary({
              passed: event.passed ?? 0,
              failed: event.failed ?? 0,
              total: event.total ?? displayRows.length,
            });
            setRunning(false);
          }
          if (event.type === "error") {
            setError(event.detail || "Evaluation failed");
            setRunning(false);
          }
        },
        onError: (msg) => {
          setError(msg);
          setRunning(false);
        },
      });
    } catch (err) {
      setError((err as Error).message);
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-surface-700 bg-surface-900/80 p-5 backdrop-blur">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">
          Classroom lab
        </div>
        <h2 className="text-lg font-semibold text-white">Evaluation harness</h2>
        <p className="mt-1 text-sm text-slate-400">
          Run a golden question set through the agent and score answers by execution
          accuracy against gold SQL results.
        </p>

        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="mt-4 rounded-lg bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent-glow ring-1 ring-accent/40 transition hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "Running evaluation…" : "Run evaluation"}
        </button>

        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {DEMO_TIPS.map((tip) => (
            <li key={tip}>• {tip}</li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-surface-700 bg-surface-900/60 p-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-slate-500">Total</div>
          <div className="mt-1 text-xl font-semibold text-white">{scoreboard.total}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-emerald-400/80">
            Passed
          </div>
          <div className="mt-1 text-xl font-semibold text-emerald-300">
            {scoreboard.passed}
          </div>
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-center">
          <div className="text-[10px] uppercase tracking-widest text-red-400/80">
            Failed
          </div>
          <div className="mt-1 text-xl font-semibold text-red-300">{scoreboard.failed}</div>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900/60 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
          Golden cases ({displayRows.length})
        </div>
        {displayRows.length === 0 && (
          <p className="text-sm text-slate-500">
            No cases loaded yet. Click Run evaluation to fetch the golden set.
          </p>
        )}
        {displayRows.map((row) => {
          const open = expandedId === row.id;
          return (
            <div
              key={row.id}
              className="rounded-xl border border-surface-700 bg-surface-800/40 p-3"
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() => setExpandedId(open ? null : row.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
                      {row.id}
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide ring-1 ${
                        statusStyles[row.status]
                      }`}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-white">{row.question}</p>
                  {row.detail && (
                    <p className="mt-1 text-xs text-slate-400">{row.detail}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-500">
                  {open ? "Hide" : "Details"}
                </span>
              </button>

              {open && (
                <div className="mt-3 space-y-3 border-t border-surface-700 pt-3">
                  {row.notes && (
                    <p className="text-xs text-slate-400">
                      <span className="text-slate-500">Tip: </span>
                      {row.notes}
                    </p>
                  )}
                  {(row.gold_rows != null || row.agent_rows != null) && (
                    <p className="text-xs text-slate-500">
                      Rows — gold: {row.gold_rows ?? "—"} · agent: {row.agent_rows ?? "—"}
                    </p>
                  )}
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-accent">
                      Gold SQL
                    </div>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-surface-950 p-2 font-mono text-xs text-emerald-300">
                      {row.gold_sql}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-widest text-slate-500">
                      Agent SQL
                    </div>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-surface-950 p-2 font-mono text-xs text-slate-300">
                      {row.agent_sql || "(none extracted)"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
