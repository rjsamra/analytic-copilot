import { useMemo, useState } from "react";
import type { Guardrail, GuardrailCheck, GuardrailType } from "../types";
import { GUARDRAIL_TYPE_LABELS } from "../types";
import { deleteGuardrail, upsertGuardrail } from "../api/client";

interface Props {
  guardrails: Guardrail[];
  attachedIds: string[];
  checks: GuardrailCheck[];
  onAttachedChange: (ids: string[]) => void;
  onLibraryChange: (guardrails: Guardrail[]) => void;
}

const TYPE_OPTIONS: GuardrailType[] = [
  "sql_safety",
  "row_cap",
  "table_allowlist",
  "topic_block",
  "business_rule",
];

const DEMO_TIPS = [
  "Attach No dangerous SQL, then ask the agent to delete discontinued products.",
  "Attach Max 50 rows and ask for all order details.",
  "Attach No HR/salary and ask: what is each employee’s salary?",
  "Attach Revenue on ShippedDate and ask for total sales by year.",
];

function defaultConfig(type: GuardrailType): Record<string, unknown> {
  switch (type) {
    case "sql_safety":
      return {
        blocked_keywords: [
          "DROP",
          "DELETE",
          "UPDATE",
          "INSERT",
          "ALTER",
          "TRUNCATE",
          "CREATE",
          "REPLACE",
        ],
      };
    case "row_cap":
      return { max_rows: 50 };
    case "table_allowlist":
      return { allowed_tables: ["orders", "customers"] };
    case "topic_block":
      return { keywords: ["salary", "wage", "ssn"] };
    case "business_rule":
      return { rule: "Revenue recognized on ShippedDate" };
    default:
      return {};
  }
}

const checkStyles: Record<string, string> = {
  passed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  blocked: "bg-red-500/15 text-red-300 ring-red-500/30",
  applied: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  capped: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  skipped: "bg-slate-500/15 text-slate-400 ring-slate-500/30",
  pending: "bg-surface-700/60 text-slate-400 ring-surface-600",
};

export default function GuardrailsPanel({
  guardrails,
  attachedIds,
  checks,
  onAttachedChange,
  onLibraryChange,
}: Props) {
  const [mode, setMode] = useState<"attach" | "define">("attach");
  const [name, setName] = useState("");
  const [type, setType] = useState<GuardrailType>("topic_block");
  const [description, setDescription] = useState("");
  const [configText, setConfigText] = useState(
    JSON.stringify(defaultConfig("topic_block"), null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const checkById = useMemo(() => {
    const map = new Map<string, GuardrailCheck>();
    for (const c of checks) map.set(c.id, c);
    return map;
  }, [checks]);

  const toggleAttach = (id: string) => {
    if (attachedIds.includes(id)) {
      onAttachedChange(attachedIds.filter((x) => x !== id));
    } else {
      onAttachedChange([...attachedIds, id]);
    }
  };

  const handleTypeChange = (next: GuardrailType) => {
    setType(next);
    setConfigText(JSON.stringify(defaultConfig(next), null, 2));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const config = JSON.parse(configText) as Record<string, unknown>;
      const created = await upsertGuardrail({
        name: name.trim(),
        type,
        description: description.trim(),
        config,
      });
      onLibraryChange([...guardrails.filter((g) => g.id !== created.id), created]);
      setName("");
      setDescription("");
      setMode("attach");
      onAttachedChange([...new Set([...attachedIds, created.id])]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deleteGuardrail(id);
      onLibraryChange(guardrails.filter((g) => g.id !== id));
      onAttachedChange(attachedIds.filter((x) => x !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-surface-700 bg-surface-900/80 p-5 backdrop-blur">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">
          Demo controls
        </div>
        <h2 className="text-lg font-semibold text-white">Guardrails</h2>
        <p className="mt-1 text-sm text-slate-400">
          Define policies, attach them to this session, and watch pass/block checks in the pipeline.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("define")}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              mode === "define"
                ? "bg-accent/20 text-accent-glow ring-1 ring-accent/40"
                : "border border-surface-600 text-slate-300 hover:bg-surface-800"
            }`}
          >
            1. Define
          </button>
          <button
            type="button"
            onClick={() => setMode("attach")}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              mode === "attach"
                ? "bg-accent/20 text-accent-glow ring-1 ring-accent/40"
                : "border border-surface-600 text-slate-300 hover:bg-surface-800"
            }`}
          >
            2. Attach
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {mode === "attach" ? (
        <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Library ({attachedIds.length} attached)
          </div>
          {guardrails.map((g) => {
            const attached = attachedIds.includes(g.id);
            const check = checkById.get(g.id);
            return (
              <label
                key={g.id}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                  attached
                    ? "border-accent/40 bg-accent/5"
                    : "border-surface-700 bg-surface-800/40 hover:border-surface-600"
                }`}
              >
                <input
                  type="checkbox"
                  checked={attached}
                  onChange={() => toggleAttach(g.id)}
                  className="mt-1 rounded border-surface-600 bg-surface-800 text-accent focus:ring-accent"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{g.name}</span>
                    <span className="rounded-md bg-surface-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                      {GUARDRAIL_TYPE_LABELS[g.type]}
                    </span>
                    {g.preset && (
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        preset
                      </span>
                    )}
                    {check && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wide ring-1 ${
                          checkStyles[check.status] || checkStyles.pending
                        }`}
                      >
                        {check.status}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{g.description}</p>
                  {check?.detail && (
                    <p className="mt-1 text-xs text-slate-300">{check.detail}</p>
                  )}
                  {!g.preset && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleDelete(g.id);
                      }}
                      className="mt-2 text-xs text-red-300 hover:text-red-200"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </label>
            );
          })}

          <div className="rounded-xl border border-dashed border-surface-600 bg-surface-900/50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Classroom demo
            </div>
            <ul className="space-y-1.5 text-xs text-slate-400">
              {DEMO_TIPS.map((tip) => (
                <li key={tip} className="flex gap-2">
                  <span className="text-accent">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900/60 p-4"
        >
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Define a new guardrail
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="e.g. Block employee PII"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Type</label>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as GuardrailType)}
              className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {GUARDRAIL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              placeholder="Shown in the UI for demos"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Config (JSON)</label>
            <textarea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-surface-600 bg-surface-950 px-3 py-2 font-mono text-xs text-emerald-300 focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-surface-950 transition hover:bg-accent-glow disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & attach"}
          </button>
        </form>
      )}
    </div>
  );
}
