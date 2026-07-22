import { motion, AnimatePresence } from "framer-motion";
import type {
  ContextRetrieval,
  Guardrail,
  GuardrailCheck,
  PipelineStep,
  ValidationCheck,
} from "../types";
import { GUARDRAIL_TYPE_LABELS } from "../types";

interface Props {
  steps: PipelineStep[];
  activeCode?: string;
  sql?: string | null;
  attachedGuardrails?: Guardrail[];
  guardrailChecks?: GuardrailCheck[];
  validationChecks?: ValidationCheck[];
  sanityWarnings?: string[];
  cacheHit?: boolean;
  contextRetrieval?: ContextRetrieval | null;
}

const statusStyles = {
  idle: "border-surface-600 bg-surface-800/50 text-slate-500",
  active: "border-accent bg-accent/10 text-accent-glow animate-pulseGlow",
  complete: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/50 bg-red-500/10 text-red-300",
};

const dotStyles = {
  idle: "bg-slate-600",
  active: "bg-accent shadow-[0_0_12px_#22d3ee]",
  complete: "bg-emerald-400",
  error: "bg-red-400",
};

const checkStyles: Record<string, string> = {
  passed: "text-emerald-300",
  blocked: "text-red-300",
  applied: "text-sky-300",
  capped: "text-amber-300",
  skipped: "text-slate-400",
  pending: "text-slate-500",
  failed: "text-red-300",
};

export default function PipelineVisualization({
  steps,
  activeCode,
  sql,
  attachedGuardrails = [],
  guardrailChecks = [],
  validationChecks = [],
  sanityWarnings = [],
  cacheHit = false,
  contextRetrieval = null,
}: Props) {
  const activeStep = steps.find((s) => s.status === "active");
  const checkById = new Map(guardrailChecks.map((c) => [c.id, c]));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-surface-700 bg-surface-900/80 p-5 backdrop-blur">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">
          Behind the scenes
        </div>
        <h2 className="text-lg font-semibold text-white">Agent Pipeline</h2>
        <p className="mt-1 text-sm text-slate-400">
          Watch how your question flows through the Analytic Copilot agent
        </p>
      </div>

      {attachedGuardrails.length > 0 && (
        <div className="rounded-2xl border border-surface-700 bg-surface-900/60 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
            Active guardrails
          </div>
          <div className="flex flex-wrap gap-2">
            {attachedGuardrails.map((g) => {
              const check = checkById.get(g.id);
              const status = check?.status ?? "pending";
              return (
                <div
                  key={g.id}
                  className="rounded-lg border border-surface-600 bg-surface-800/70 px-2.5 py-1.5"
                  title={check?.detail || g.description}
                >
                  <div className="text-xs font-medium text-white">{g.name}</div>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide">
                    <span className="text-slate-500">
                      {GUARDRAIL_TYPE_LABELS[g.type]}
                    </span>
                    <span className={checkStyles[status] || checkStyles.pending}>
                      {status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="relative flex-1 overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900/60 p-4">
        <div className="space-y-0">
          {steps.map((step, index) => (
            <div key={step.id} className="relative">
              {index < steps.length - 1 && (
                <motion.div
                  className="absolute left-[1.125rem] top-10 h-[calc(100%-1.5rem)] w-px origin-top bg-surface-600"
                  initial={{ scaleY: 0 }}
                  animate={{
                    scaleY: step.status === "complete" || step.status === "active" ? 1 : 0.15,
                    backgroundColor:
                      step.status === "complete"
                        ? "rgba(52, 211, 153, 0.5)"
                        : step.status === "active"
                          ? "rgba(34, 211, 238, 0.6)"
                          : "rgba(71, 85, 105, 0.4)",
                  }}
                  transition={{ duration: 0.5 }}
                />
              )}

              <motion.div
                layout
                className={`relative mb-3 rounded-xl border p-4 transition-colors ${statusStyles[step.status]}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <div className="flex items-start gap-3">
                  <motion.div
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotStyles[step.status]}`}
                    animate={step.status === "active" ? { scale: [1, 1.3, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{step.label}</span>
                      <span className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
                        {step.id === "resolve" && cacheHit && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                            CACHE HIT
                          </span>
                        )}
                        {step.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs opacity-80">{step.description}</p>

                    <AnimatePresence>
                      {(step.detail || (step.status === "active" && activeStep?.id === step.id)) && (
                        <motion.p
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="mt-2 overflow-hidden text-xs leading-relaxed opacity-90"
                        >
                          {step.detail}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    {step.id === "guardrails" && guardrailChecks.length > 0 && (
                      <CheckList
                        checks={guardrailChecks.map((c) => ({
                          name: c.name,
                          status: c.status,
                          detail: c.detail,
                        }))}
                      />
                    )}

                    {step.id === "context" && contextRetrieval && (
                      <div className="mt-2 space-y-2 text-xs">
                        {contextRetrieval.scenarios.length > 0 && (
                          <div>
                            <div className="mb-1 font-medium opacity-80">Scenario RAG</div>
                            <ul className="space-y-1">
                              {contextRetrieval.scenarios.map((s) => (
                                <li key={s.name} className="opacity-90">
                                  <span className="text-sky-300">{s.name}</span>
                                  {s.score != null && (
                                    <span className="ml-2 opacity-60">
                                      score {Number(s.score).toFixed(3)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {contextRetrieval.tables.length > 0 && (
                          <div>
                            <div className="mb-1 font-medium opacity-80">Schema hits</div>
                            <ul className="space-y-1">
                              {contextRetrieval.tables.map((t, i) => (
                                <li key={`${t.table}-${i}`} className="opacity-90">
                                  <span className="text-emerald-300">{t.table || t.type}</span>
                                  {t.score != null && (
                                    <span className="ml-2 opacity-60">
                                      score {Number(t.score).toFixed(3)}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {step.id === "validate" && validationChecks.length > 0 && (
                      <CheckList checks={validationChecks} />
                    )}

                    {step.id === "sanity" && sanityWarnings.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {sanityWarnings.map((w) => (
                          <li key={w} className="text-xs text-amber-300">
                            ⚠ {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {(activeCode || sql) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="rounded-2xl border border-surface-700 bg-surface-900/90 p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Generated code
              </span>
            </div>
            {sql && (
              <div className="mb-3">
                <div className="mb-1 text-xs text-accent">SQL</div>
                <pre className="max-h-28 overflow-auto rounded-lg bg-surface-950 p-3 font-mono text-xs text-emerald-300">
                  {sql}
                </pre>
              </div>
            )}
            {activeCode && (!sql || normalizeCode(activeCode) !== normalizeCode(sql)) && (
              <pre className="max-h-40 overflow-auto rounded-lg bg-surface-950 p-3 font-mono text-xs text-slate-300">
                <TypingCode code={activeCode} />
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CheckList({ checks }: { checks: { name: string; status: string; detail?: string }[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {checks.map((c) => (
        <li key={`${c.name}-${c.status}`} className="text-xs">
          <span className={checkStyles[c.status] || checkStyles.pending}>[{c.status}]</span>{" "}
          <span className="opacity-90">{c.name}</span>
          {c.detail ? <span className="opacity-70"> — {c.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function normalizeCode(code: string): string {
  return code.replace(/^['"]{3}|['"]{3}$/g, "").trim();
}

function TypingCode({ code }: { code: string }) {
  const preview = code.length > 1200 ? code.slice(0, 1200) + "\n# ..." : code;
  return <>{preview}</>;
}
