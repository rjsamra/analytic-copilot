import type { ClarificationPayload } from "../types";

interface Props {
  clarification: ClarificationPayload;
  onSelect: (optionId: string, metricId?: string) => void;
  disabled?: boolean;
}

export default function ClarificationPrompt({ clarification, onSelect, disabled }: Props) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="text-sm font-medium text-amber-100">{clarification.question}</p>
      <div className="mt-3 flex flex-col gap-2">
        {clarification.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.id, opt.metric_id)}
            className="rounded-lg border border-surface-600 bg-surface-800/80 px-4 py-3 text-left transition hover:border-accent/50 hover:bg-surface-800 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{opt.label}</span>
              {opt.recommended && (
                <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-glow">
                  Recommended
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">{opt.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
