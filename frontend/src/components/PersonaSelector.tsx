import type { UserProfile } from "../types";

interface Props {
  profiles: UserProfile[];
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export default function PersonaSelector({ profiles, selectedId, onChange, disabled }: Props) {
  const selected = profiles.find((p) => p.id === selectedId);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="persona-select" className="text-xs text-slate-400">
        Persona
      </label>
      <select
        id="persona-select"
        value={selectedId}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        title={
          selected
            ? `Role: ${selected.role} · Region: ${selected.region} · Defaults: ${JSON.stringify(selected.metric_defaults ?? {})}`
            : undefined
        }
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
          </option>
        ))}
      </select>
      {selected && (
        <span className="hidden rounded-lg bg-surface-800 px-2 py-1 text-xs text-slate-400 ring-1 ring-surface-600 md:inline">
          {selected.role} · {selected.region}
        </span>
      )}
    </div>
  );
}
