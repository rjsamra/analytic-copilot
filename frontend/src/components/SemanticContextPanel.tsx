import type { SemanticContext } from "../types";

interface Props {
  context: SemanticContext | null;
}

export default function SemanticContextPanel({ context }: Props) {
  if (!context) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-surface-600 p-8 text-center">
        <p className="text-sm text-slate-400">
          Ask a question to see live semantic context — persona, metric, filters, and cache status.
        </p>
      </div>
    );
  }

  const cacheLabel =
    context.cacheStatus === "hit"
      ? "Cache hit"
      : context.cacheStatus === "stored"
        ? "Stored (14 days)"
        : context.cacheStatus === "miss"
          ? "Cache miss"
          : "—";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="rounded-2xl border border-surface-700 bg-surface-900/80 p-5">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">
          Semantic layer
        </div>
        <h2 className="text-lg font-semibold text-white">Live context</h2>
        <p className="mt-1 text-sm text-slate-400">
          Metric definitions and scope applied for this request
        </p>
      </div>

      <Section title="Active persona">
        <Row label="Name" value={context.displayName || "—"} />
        <Row label="Role" value={context.role || "—"} />
        <Row label="Region" value={context.region || "—"} />
        {context.defaults && Object.keys(context.defaults).length > 0 && (
          <div className="mt-2">
            <div className="text-xs text-slate-500">Metric defaults</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
              {Object.entries(context.defaults).map(([k, v]) => (
                <li key={k}>
                  {k} → <span className="text-accent-glow">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {context.resolution && context.resolution.status === "ready" && (
        <Section title="Resolved metric">
          <Row label="Metric" value={context.resolution.metric_label || context.resolution.metric_id || "—"} />
          <Row label="Date basis" value={context.resolution.time_dimension_label || "—"} />
          {context.resolution.time_range_label && (
            <Row label="Period" value={context.resolution.time_range_label} />
          )}
          {context.resolution.scope_label && (
            <Row label="Scope" value={context.resolution.scope_label} />
          )}
          {context.resolution.tables && context.resolution.tables.length > 0 && (
            <Row label="Tables" value={context.resolution.tables.join(", ")} />
          )}
          {context.resolution.assumptions && context.resolution.assumptions.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-slate-500">Assumptions</div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-300">
                {context.resolution.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section title="Cache">
        <Row label="Status" value={cacheLabel} highlight={context.cacheStatus === "hit"} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-surface-700 bg-surface-900/60 p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={highlight ? "font-medium text-emerald-300" : "text-slate-200"}>{value}</span>
    </div>
  );
}
