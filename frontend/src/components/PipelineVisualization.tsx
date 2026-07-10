import { motion, AnimatePresence } from "framer-motion";
import type { PipelineStep } from "../types";

interface Props {
  steps: PipelineStep[];
  activeCode?: string;
  sql?: string | null;
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

export default function PipelineVisualization({ steps, activeCode, sql }: Props) {
  const activeStep = steps.find((s) => s.status === "active");

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-surface-700 bg-surface-900/80 p-5 backdrop-blur">
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-accent">
          Behind the scenes
        </div>
        <h2 className="text-lg font-semibold text-white">Agent Pipeline</h2>
        <p className="mt-1 text-sm text-slate-400">
          Watch how your question flows through the Text-to-SQL agent
        </p>
      </div>

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
                      <span className="text-xs uppercase tracking-wide opacity-70">
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
            {activeCode && (
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

function TypingCode({ code }: { code: string }) {
  const preview = code.length > 1200 ? code.slice(0, 1200) + "\n# ..." : code;
  return <>{preview}</>;
}
