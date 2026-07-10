import { useCallback, useEffect, useState } from "react";
import { clearSession, fetchSampleQuestions, streamChat } from "./api/client";
import ChatPanel from "./components/ChatPanel";
import PipelineVisualization from "./components/PipelineVisualization";
import type {
  ChatMessage,
  DisplayPayload,
  PipelineStep,
  PipelineStepId,
  StreamEvent,
} from "./types";
import { PIPELINE_STEPS } from "./types";

const INIT_MESSAGE =
  "Hello, I am your AI Analytic Assistant. Ask me anything about the Northwind database — I'll translate your question into SQL, run the analysis, and show you the results.";

function initialSteps(): PipelineStep[] {
  return PIPELINE_STEPS.map((s) => ({ ...s, status: "idle" as const }));
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "init", role: "assistant", content: INIT_MESSAGE },
  ]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>(initialSteps);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sampleQuestions, setSampleQuestions] = useState<string[]>([]);
  const [activeCode, setActiveCode] = useState<string | undefined>();
  const [activeSql, setActiveSql] = useState<string | null | undefined>();
  const [showPipeline, setShowPipeline] = useState(true);

  useEffect(() => {
    fetchSampleQuestions().then(setSampleQuestions).catch(() => {});
  }, []);

  const updateStep = useCallback((stepId: PipelineStepId, patch: Partial<PipelineStep>) => {
    setPipelineSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    );
  }, []);

  const handleStreamEvent = useCallback(
    (event: StreamEvent, displays: DisplayPayload[]) => {
      if (event.type === "step_start" && event.step) {
        setPipelineSteps((prev) =>
          prev.map((s) => {
            if (s.id === event.step) {
              return {
                ...s,
                status: "active",
                detail: event.detail || event.label,
                code: event.code,
              };
            }
            return s;
          }),
        );
        if (event.code) setActiveCode(event.code);
      }

      if (event.type === "step_complete" && event.step) {
        updateStep(event.step, {
          status: "complete",
          detail: event.detail || undefined,
          code: event.code,
        });
        if (event.code) setActiveCode(event.code);
      }

      if (event.type === "step_error" && event.step) {
        updateStep(event.step, { status: "error", detail: event.detail });
      }

      if (event.type === "display" && event.display) {
        displays.push(event.display);
      }

      if (event.type === "done") {
        if (event.session_id) setSessionId(event.session_id);
        if (event.code) setActiveCode(event.code);
        if (event.sql !== undefined) setActiveSql(event.sql);

        const finalDisplays = event.displays?.length ? event.displays : displays;

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: event.answer || "Done.",
            displays: finalDisplays,
            sql: event.sql,
            code: event.code,
          },
        ]);
        setIsLoading(false);
      }

      if (event.type === "error") {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Sorry, something went wrong: ${event.detail}`,
          },
        ]);
        setIsLoading(false);
      }
    },
    [updateStep],
  );

  const handleSend = useCallback(
    (text: string) => {
      if (isLoading) return;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: text },
      ]);
      setPipelineSteps(initialSteps().map((s) => ({ ...s, status: "idle" })));
      setActiveCode(undefined);
      setActiveSql(undefined);
      setIsLoading(true);

      const displays: DisplayPayload[] = [];

      streamChat(text, sessionId, false, {
        onEvent: (event) => handleStreamEvent(event, displays),
        onError: (error) => {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Connection error: ${error}`,
            },
          ]);
          setIsLoading(false);
        },
      });
    },
    [handleStreamEvent, isLoading, sessionId],
  );

  const handleClear = async () => {
    if (sessionId) await clearSession(sessionId);
    setSessionId(null);
    setMessages([{ id: "init", role: "assistant", content: INIT_MESSAGE }]);
    setPipelineSteps(initialSteps());
    setActiveCode(undefined);
    setActiveSql(undefined);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#132040_0%,_#070b14_55%)]">
      <header className="border-b border-surface-700/80 bg-surface-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 ring-1 ring-accent/40">
              <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 7 4 8 4 10zm4 3h8M8 11h.01M12 11h.01M16 11h.01" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">TextToSQL</h1>
              <p className="text-xs text-slate-400">Generative Business Intelligence Assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={showPipeline}
                onChange={(e) => setShowPipeline(e.target.checked)}
                className="rounded border-surface-600 bg-surface-800 text-accent focus:ring-accent"
              />
              Show pipeline
            </label>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-surface-600 px-3 py-1.5 text-sm text-slate-300 transition hover:border-surface-500 hover:bg-surface-800"
            >
              Clear chat
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-6 p-6 lg:grid-cols-2">
        <section className="flex min-h-[calc(100vh-7rem)] flex-col rounded-2xl border border-surface-700/80 bg-surface-900/40 p-5 backdrop-blur">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-500">
            Conversation
          </h2>
          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            onSend={handleSend}
            sampleQuestions={sampleQuestions}
          />
        </section>

        {showPipeline && (
          <section className="min-h-[calc(100vh-7rem)] rounded-2xl border border-surface-700/80 bg-surface-900/40 p-5 backdrop-blur">
            <PipelineVisualization
              steps={pipelineSteps}
              activeCode={activeCode}
              sql={activeSql}
            />
          </section>
        )}
      </main>
    </div>
  );
}
