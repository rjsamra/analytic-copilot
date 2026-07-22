import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveApproval,
  fetchApprovals,
  rejectApproval,
  updateApproval,
} from "../api/client";
import type { DraftMetric, MetricProposal, ProposalStatus } from "../types";

interface Props {
  onPendingCountChange?: (count: number) => void;
}

const STATUS_STYLES: Record<ProposalStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 ring-red-500/30",
};

const EMPTY_DRAFT: DraftMetric = {
  id: "",
  label: "",
  description: "",
  expression: "",
  from_clause: "",
  time_dimension: "",
  time_dimension_label: "",
  required_filters: [],
  tables: [],
  synonyms: [],
  ambiguities: [],
  select_label: "",
};

export default function ApprovalsPage({ onPendingCountChange }: Props) {
  const [proposals, setProposals] = useState<MetricProposal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | ProposalStatus>("pending");
  const [sql, setSql] = useState("");
  const [draft, setDraft] = useState<DraftMetric>(EMPTY_DRAFT);
  const [synonymsText, setSynonymsText] = useState("");
  const [tablesText, setTablesText] = useState("");
  const [filtersText, setFiltersText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApprovals();
      setProposals(data.proposals);
      onPendingCountChange?.(data.pending_count);
      setSelectedId((prev) => {
        if (prev && data.proposals.some((p) => p.id === prev)) return prev;
        const firstPending = data.proposals.find((p) => p.status === "pending");
        return firstPending?.id || data.proposals[0]?.id || null;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => proposals.find((p) => p.id === selectedId) || null,
    [proposals, selectedId],
  );

  useEffect(() => {
    if (!selected) {
      setSql("");
      setDraft(EMPTY_DRAFT);
      setSynonymsText("");
      setTablesText("");
      setFiltersText("");
      return;
    }
    setSql(selected.proposed_sql || "");
    const d = { ...EMPTY_DRAFT, ...(selected.draft_metric || {}) };
    setDraft(d);
    setSynonymsText((d.synonyms || []).join(", "));
    setTablesText((d.tables || []).join(", "));
    setFiltersText((d.required_filters || []).join("\n"));
  }, [selected]);

  const filtered = useMemo(() => {
    if (filter === "all") return proposals;
    return proposals.filter((p) => p.status === filter);
  }, [filter, proposals]);

  const patchDraft = <K extends keyof DraftMetric>(key: K, value: DraftMetric[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const buildDraftPayload = (): DraftMetric => ({
    ...draft,
    synonyms: synonymsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    tables: tablesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    required_filters: filtersText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    select_label: draft.select_label || draft.id,
  });

  const handleSave = async () => {
    if (!selected || selected.status !== "pending") return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateApproval(selected.id, {
        proposed_sql: sql,
        draft_metric: buildDraftPayload(),
      });
      setProposals((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    if (!selected || selected.status !== "pending") return;
    setBusy(true);
    setError(null);
    try {
      await updateApproval(selected.id, {
        proposed_sql: sql,
        draft_metric: buildDraftPayload(),
      });
      const { proposal, pending_count } = await approveApproval(selected.id);
      setProposals((prev) => prev.map((p) => (p.id === proposal.id ? proposal : p)));
      onPendingCountChange?.(pending_count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!selected || selected.status !== "pending") return;
    const reason = window.prompt("Rejection reason (optional)") || "";
    setBusy(true);
    setError(null);
    try {
      const { proposal, pending_count } = await rejectApproval(selected.id, reason);
      setProposals((prev) => prev.map((p) => (p.id === proposal.id ? proposal : p)));
      onPendingCountChange?.(pending_count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 gap-4">
      <aside className="flex w-80 shrink-0 flex-col rounded-2xl border border-surface-700 bg-surface-900/80">
        <div className="border-b border-surface-700 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-accent">
            Layer B
          </div>
          <h2 className="mt-1 text-lg font-semibold text-white">Metric Approvals</h2>
          <p className="mt-1 text-xs text-slate-400">
            Review SQL from unmatched questions before promoting to metrics.json
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {(["pending", "approved", "rejected", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-[11px] uppercase tracking-wide ${
                  filter === f
                    ? "bg-accent/20 text-accent"
                    : "bg-surface-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loading && <div className="p-3 text-sm text-slate-400">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="p-3 text-sm text-slate-500">No proposals</div>
          )}
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`mb-2 w-full rounded-xl border p-3 text-left transition ${
                selectedId === p.id
                  ? "border-accent/50 bg-accent/10"
                  : "border-surface-700 bg-surface-800/50 hover:border-surface-500"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ring-1 ${STATUS_STYLES[p.status]}`}>
                  {p.status}
                </span>
                <span className="text-[10px] text-slate-500">
                  {p.created_at?.slice(0, 10)}
                </span>
              </div>
              <div className="mt-2 line-clamp-2 text-sm text-slate-200">{p.question}</div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">{p.id}</div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-surface-700 bg-surface-900/80">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            Select a proposal to review
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-surface-700 p-4">
              <div>
                <div className="text-xs text-slate-500">{selected.id}</div>
                <h3 className="mt-1 text-base font-semibold text-white">{selected.question}</h3>
                {selected.scenario_hits && selected.scenario_hits.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.scenario_hits.map((s) => (
                      <span
                        key={s.name}
                        className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300"
                      >
                        {s.name}
                        {s.score != null ? ` · ${Number(s.score).toFixed(2)}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {selected.status === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSave}
                    className="rounded-lg border border-surface-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-surface-800 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleReject}
                    className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleApprove}
                    className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    Approve → metrics.json
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="mx-4 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Proposed SQL
                </label>
                <textarea
                  value={sql}
                  onChange={(e) => setSql(e.target.value)}
                  disabled={selected.status !== "pending"}
                  className="h-64 w-full rounded-xl border border-surface-600 bg-surface-950 p-3 font-mono text-xs text-emerald-300 focus:border-accent focus:outline-none disabled:opacity-60"
                />
              </div>

              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Draft metric
                </div>
                {(
                  [
                    ["id", "Metric id"],
                    ["label", "Label"],
                    ["select_label", "Select label"],
                    ["description", "Description"],
                    ["expression", "Expression"],
                    ["from_clause", "From clause"],
                    ["time_dimension", "Time dimension"],
                    ["time_dimension_label", "Time dimension label"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="mb-1 block text-[11px] text-slate-400">{label}</label>
                    <input
                      value={String(draft[key] ?? "")}
                      onChange={(e) => patchDraft(key, e.target.value)}
                      disabled={selected.status !== "pending"}
                      className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:opacity-60"
                    />
                  </div>
                ))}
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Synonyms (comma-separated)
                  </label>
                  <input
                    value={synonymsText}
                    onChange={(e) => setSynonymsText(e.target.value)}
                    disabled={selected.status !== "pending"}
                    className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Tables (comma-separated)
                  </label>
                  <input
                    value={tablesText}
                    onChange={(e) => setTablesText(e.target.value)}
                    disabled={selected.status !== "pending"}
                    className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:opacity-60"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-slate-400">
                    Required filters (one per line)
                  </label>
                  <textarea
                    value={filtersText}
                    onChange={(e) => setFiltersText(e.target.value)}
                    disabled={selected.status !== "pending"}
                    className="h-20 w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-slate-200 focus:border-accent focus:outline-none disabled:opacity-60"
                  />
                </div>
                {selected.reject_reason && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    Rejected: {selected.reject_reason}
                  </div>
                )}
                {selected.approved_metric_id && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                    Promoted as metric: {selected.approved_metric_id}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
