import { useState } from "react";
import type { ResolutionPayload, SanityResult } from "../types";

interface Props {
  resolution?: ResolutionPayload | null;
  sanity?: SanityResult | null;
  pendingApproval?: boolean;
  proposalId?: string | null;
  sql?: string | null;
}

const STRUCTURED_ASSUMPTION_PREFIXES = ["Metric:", "Date basis:", "Period:", "Scope:"];

function extraAssumptions(assumptions?: string[]) {
  return (assumptions ?? []).filter(
    (a) => !STRUCTURED_ASSUMPTION_PREFIXES.some((prefix) => a.startsWith(prefix)),
  );
}

export default function AssumptionsCard({
  resolution,
  sanity,
  pendingApproval,
  proposalId,
  sql,
}: Props) {
  const [open, setOpen] = useState(true);

  const supplemental = extraAssumptions(resolution?.assumptions);

  const hasStructured =
    Boolean(resolution?.metric_label) ||
    Boolean(resolution?.time_dimension_label) ||
    Boolean(resolution?.time_range_label) ||
    Boolean(resolution?.scope_label) ||
    supplemental.length > 0;

  const isAgentFallback =
    !hasStructured &&
    (pendingApproval ||
      resolution?.status === "no_metric" ||
      Boolean(sql) ||
      Boolean(sanity && !resolution?.metric_label));

  if (!resolution && !sanity && !pendingApproval) return null;

  return (
    <div className="mt-3 rounded-xl border border-surface-600 bg-surface-900/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-semibold uppercase tracking-widest text-slate-400"
      >
        Assumptions & sanity checks
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-surface-700 px-4 py-3 text-xs text-slate-300">
          {resolution?.metric_label && (
            <div>
              <span className="text-slate-500">Metric: </span>
              {resolution.metric_label}
            </div>
          )}
          {resolution?.time_dimension_label && (
            <div>
              <span className="text-slate-500">Date basis: </span>
              {resolution.time_dimension_label}
            </div>
          )}
          {resolution?.time_range_label && (
            <div>
              <span className="text-slate-500">Period: </span>
              {resolution.time_range_label}
            </div>
          )}
          {resolution?.scope_label && (
            <div>
              <span className="text-slate-500">Scope: </span>
              {resolution.scope_label}
            </div>
          )}
          {supplemental.map((a) => (
            <div key={a} className="text-slate-400">
              {a}
            </div>
          ))}

          {isAgentFallback && (
            <>
              <div>
                <span className="text-slate-500">Path: </span>
                Agent fallback — no approved semantic metric matched
              </div>
              {pendingApproval && (
                <div>
                  <span className="text-slate-500">Status: </span>
                  Queued for analyst approval
                  {proposalId ? (
                    <span className="ml-1 font-mono text-[10px] text-amber-300/80">
                      ({proposalId})
                    </span>
                  ) : null}
                </div>
              )}
              {sql && (
                <div>
                  <span className="text-slate-500">SQL basis: </span>
                  <span className="font-mono text-[10px] text-emerald-300/90">
                    {sql.length > 120 ? `${sql.slice(0, 120)}…` : sql}
                  </span>
                </div>
              )}
            </>
          )}

          {sanity && (
            <div className="mt-2 border-t border-surface-700 pt-2 text-slate-400">
              Sanity: {sanity.row_count} rows
              {sanity.date_range ? ` · ${sanity.date_range}` : ""}
              {sanity.warnings.length > 0
                ? ` · ${sanity.warnings.length} warning(s)`
                : " · no warnings"}
            </div>
          )}
          {sanity?.warnings.map((w) => (
            <div key={w} className="text-amber-300">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
