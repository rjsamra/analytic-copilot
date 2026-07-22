import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearSession,
  fetchApprovals,
  fetchGuardrails,
  fetchSampleQuestions,
  fetchUserProfiles,
  streamChat,
} from "./api/client";
import type { ClarificationResponsePayload } from "./api/client";
import ApprovalsPage from "./components/ApprovalsPage";
import ChatPanel from "./components/ChatPanel";
import GuardrailsPanel from "./components/GuardrailsPanel";
import PersonaSelector from "./components/PersonaSelector";
import PipelineVisualization from "./components/PipelineVisualization";
import SemanticContextPanel from "./components/SemanticContextPanel";
import type {
  ChatMessage,
  ClarificationPayload,
  ContextRetrieval,
  DisplayPayload,
  FeedbackVerdict,
  Guardrail,
  GuardrailCheck,
  PipelineStep,
  PipelineStepId,
  ResolutionPayload,
  SanityResult,
  SemanticContext,
  StreamEvent,
  UserProfile,
  ValidationCheck,
} from "./types";
import { PIPELINE_STEPS } from "./types";

const INIT_MESSAGE =
  "Hello, I am your AI Analytic Assistant. Ask me anything about the Northwind database — I'll resolve the right metric for your persona, show every assumption, and ask you to validate results.";

function initialSteps(): PipelineStep[] {
  return PIPELINE_STEPS.map((s) => ({ ...s, status: "idle" as const }));
}

type RightTab = "pipeline" | "guardrails" | "semantic";
type AppView = "chat" | "approvals";

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
  const [rightTab, setRightTab] = useState<RightTab>("pipeline");

  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [guardrailChecks, setGuardrailChecks] = useState<GuardrailCheck[]>([]);

  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [userProfileId, setUserProfileId] = useState("regional_manager_we");
  const [semanticContext, setSemanticContext] = useState<SemanticContext | null>(null);
  const [pendingClarification, setPendingClarification] = useState<ClarificationPayload | null>(null);
  const [validationChecks, setValidationChecks] = useState<ValidationCheck[]>([]);
  const [sanityResult, setSanityResult] = useState<SanityResult | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [lastQuestion, setLastQuestion] = useState<string>("");
  const [appView, setAppView] = useState<AppView>("chat");
  const [pendingCount, setPendingCount] = useState(0);
  const [contextRetrieval, setContextRetrieval] = useState<ContextRetrieval | null>(null);

  useEffect(() => {
    fetchSampleQuestions().then(setSampleQuestions).catch(() => {});
    fetchUserProfiles().then(setUserProfiles).catch(() => {});
    fetchApprovals()
      .then((data) => setPendingCount(data.pending_count))
      .catch(() => {});
    fetchGuardrails()
      .then((items) => {
        setGuardrails(items);
        const defaults = items
          .filter((g) => g.id === "sql-safety" || g.id === "metric-shipped-date")
          .map((g) => g.id);
        setAttachedIds(defaults);
      })
      .catch(() => {});
  }, []);

  const attachedGuardrails = useMemo(
    () => guardrails.filter((g) => attachedIds.includes(g.id)),
    [guardrails, attachedIds],
  );

  const updateStep = useCallback((stepId: PipelineStepId, patch: Partial<PipelineStep>) => {
    setPipelineSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    );
  }, []);

  const handleStreamEvent = useCallback(
    (event: StreamEvent, displays: DisplayPayload[]) => {
      if (event.type === "user_context") {
        setSemanticContext((prev) => ({
          ...prev,
          profileId: event.profile_id,
          displayName: event.display_name,
          role: event.role,
          region: event.region,
          defaults: event.defaults,
        }));
      }

      if (event.type === "metric_resolved" && event.status) {
        const resolution: ResolutionPayload = {
          status: event.status as string,
          metric_id: event.metric_id,
          metric_label: (event as StreamEvent & { metric_label?: string }).metric_label,
          time_dimension_label: (event as StreamEvent & { time_dimension_label?: string }).time_dimension_label,
          time_range_label: (event as StreamEvent & { time_range_label?: string }).time_range_label,
          scope_label: event.region,
          assumptions: (event as StreamEvent & { assumptions?: string[] }).assumptions,
          tables: (event as StreamEvent & { tables?: string[] }).tables,
          cache_hit: (event as StreamEvent & { cache_hit?: boolean }).cache_hit,
        };
        setSemanticContext((prev) => ({
          ...prev,
          resolution,
          cacheStatus: resolution.cache_hit ? "hit" : "miss",
        }));
      }

      if (event.type === "cache_hit") {
        setCacheHit(true);
        setSemanticContext((prev) => (prev ? { ...prev, cacheStatus: "hit" } : prev));
      }

      if (event.type === "validation_result" && event.checks) {
        setValidationChecks(event.checks);
      }

      if (event.type === "sanity_result") {
        setSanityResult({
          row_count: event.row_count ?? 0,
          date_range: event.date_range ?? null,
          warnings: event.warnings ?? [],
        });
      }

      if (event.type === "clarification_needed" && event.id && event.options) {
        const payload: ClarificationPayload = {
          id: event.id,
          question: event.question || "Which metric should I use?",
          options: event.options,
        };
        setPendingClarification(payload);
      }

      if (event.type === "context_retrieval") {
        const retrieval: ContextRetrieval = {
          scenarios: event.scenarios || [],
          tables: event.tables || [],
        };
        setContextRetrieval(retrieval);
        const scenarioNames = retrieval.scenarios.map((s) => s.name).join(", ");
        updateStep("context", {
          status: "complete",
          detail: scenarioNames
            ? `Retrieved scenarios: ${scenarioNames}`
            : "Context retrieved",
        });
      }

      if (event.type === "pending_proposal" && event.proposal_id) {
        setPendingCount((c) => c + 1);
        updateStep("confirm", {
          status: "complete",
          detail: `Queued for approval: ${event.proposal_id}`,
        });
      }

      if (event.type === "guardrail_check" && event.id) {
        setGuardrailChecks((prev) => {
          const entry: GuardrailCheck = {
            id: event.id!,
            name: event.name || event.id!,
            type: event.guardrail_type || "",
            status: event.status || "pending",
            detail: event.detail || "",
          };
          const existingIdx = prev.findIndex((c) => c.id === event.id);
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = { ...next[existingIdx], ...entry };
            return next;
          }
          return [...prev, entry];
        });
      }

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
        const msgId = crypto.randomUUID();

        if (event.resolution) {
          setSemanticContext((prev) => ({
            ...prev,
            resolution: event.resolution as ResolutionPayload,
            cacheStatus: event.resolution?.cache_hit ? "hit" : prev?.cacheStatus ?? "miss",
          }));
        }

        if (event.awaiting_clarification && event.clarification) {
          const clarification = event.clarification;
          setPendingClarification(clarification);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: "assistant",
              content: event.answer || clarification.question,
              clarification,
            },
          ]);
        } else {
          setPendingClarification(null);
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              role: "assistant",
              content: event.answer || "Done.",
              displays: finalDisplays,
              sql: event.sql,
              code: event.code,
              resolution: event.resolution as ResolutionPayload | null,
              sanity: event.sanity as SanityResult | null,
              awaitingConfirmation: event.awaiting_confirmation,
              cacheEligible: event.cache_eligible,
              pendingApproval: event.pending_approval,
              proposalId: event.proposal_id || null,
            },
          ]);
        }
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

  const runChat = useCallback(
    (
      text: string,
      clarification: ClarificationResponsePayload | null = null,
      addUserMessage = true,
    ) => {
      if (isLoading) return;

      if (addUserMessage) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: text },
        ]);
        setLastQuestion(text);
      }

      setPipelineSteps(initialSteps().map((s) => ({ ...s, status: "idle" })));
      setActiveCode(undefined);
      setActiveSql(undefined);
      setGuardrailChecks([]);
      setValidationChecks([]);
      setSanityResult(null);
      setCacheHit(false);
      setContextRetrieval(null);
      setSemanticContext((prev) => ({
        profileId: userProfileId,
        displayName: userProfiles.find((p) => p.id === userProfileId)?.display_name,
        role: userProfiles.find((p) => p.id === userProfileId)?.role,
        region: userProfiles.find((p) => p.id === userProfileId)?.region,
        defaults: userProfiles.find((p) => p.id === userProfileId)?.metric_defaults,
        resolution: prev?.resolution ?? null,
        cacheStatus: null,
      }));
      setIsLoading(true);
      if (showPipeline) setRightTab("pipeline");

      const displays: DisplayPayload[] = [];

      streamChat(
        text,
        sessionId,
        false,
        attachedIds,
        userProfileId,
        clarification,
        {
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
        },
      );
    },
    [
      attachedIds,
      handleStreamEvent,
      isLoading,
      sessionId,
      showPipeline,
      userProfileId,
      userProfiles,
    ],
  );

  const handleSend = useCallback(
    (text: string) => runChat(text),
    [runChat],
  );

  const handleClarificationSelect = useCallback(
    (optionId: string, metricId?: string) => {
      setPendingClarification(null);
      const label =
        pendingClarification?.options.find((o) => o.id === optionId)?.label || optionId;
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: `Using: ${label}` },
      ]);
      runChat(
        lastQuestion,
        {
          clarification_id: pendingClarification?.id || "",
          option_id: optionId,
          metric_id: metricId || optionId,
        },
        false,
      );
    },
    [lastQuestion, pendingClarification, runChat],
  );

  const handleFeedback = useCallback((messageId: string, verdict: FeedbackVerdict) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, feedbackSubmitted: verdict, awaitingConfirmation: false } : m,
      ),
    );
    if (verdict === "correct") {
      setSemanticContext((prev) => (prev ? { ...prev, cacheStatus: "stored" } : prev));
      updateStep("confirm", { status: "complete", detail: "Confirmed — cached for 14 days" });
    } else {
      updateStep("confirm", { status: "error", detail: `Feedback: ${verdict.replace("_", " ")}` });
    }
  }, [updateStep]);

  const handleClear = async () => {
    if (sessionId) await clearSession(sessionId);
    setSessionId(null);
    setMessages([{ id: "init", role: "assistant", content: INIT_MESSAGE }]);
    setPipelineSteps(initialSteps());
    setActiveCode(undefined);
    setActiveSql(undefined);
    setGuardrailChecks([]);
    setValidationChecks([]);
    setSanityResult(null);
    setSemanticContext(null);
    setPendingClarification(null);
    setCacheHit(false);
    setContextRetrieval(null);
  };

  const tabClass = (tab: RightTab) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-widest transition ${
      rightTab === tab
        ? "bg-accent/15 text-accent-glow ring-1 ring-accent/30"
        : "text-slate-500 hover:text-slate-300"
    }`;

  const viewClass = (view: AppView) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      appView === view
        ? "bg-accent/15 text-accent-glow ring-1 ring-accent/30"
        : "text-slate-400 hover:text-slate-200"
    }`;

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#132040_0%,_#070b14_55%)]">
      <header className="border-b border-surface-700/80 bg-surface-900/50 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 ring-1 ring-accent/40">
              <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 7 4 8 4 10zm4 3h8M8 11h.01M12 11h.01M16 11h.01" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Analytic Copilot</h1>
              <p className="text-xs text-slate-400">Generative BI with user semantic layer</p>
            </div>
            <nav className="ml-4 flex items-center gap-1 rounded-xl border border-surface-700 bg-surface-900/60 p-1">
              <button type="button" className={viewClass("chat")} onClick={() => setAppView("chat")}>
                Chat
              </button>
              <button
                type="button"
                className={viewClass("approvals")}
                onClick={() => setAppView("approvals")}
              >
                Approvals
                {pendingCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                    {pendingCount}
                  </span>
                )}
              </button>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {appView === "chat" && (
              <>
                <PersonaSelector
                  profiles={userProfiles}
                  selectedId={userProfileId}
                  onChange={setUserProfileId}
                  disabled={isLoading}
                />
                {attachedIds.length > 0 && (
                  <span className="hidden rounded-lg bg-accent/10 px-2 py-1 text-xs text-accent-glow ring-1 ring-accent/30 sm:inline">
                    {attachedIds.length} guardrail{attachedIds.length === 1 ? "" : "s"}
                  </span>
                )}
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
              </>
            )}
          </div>
        </div>
      </header>

      {appView === "approvals" ? (
        <main className="mx-auto h-[calc(100vh-5.5rem)] max-w-[1600px] p-6">
          <ApprovalsPage onPendingCountChange={setPendingCount} />
        </main>
      ) : (
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
            pendingClarification={pendingClarification}
            onClarificationSelect={handleClarificationSelect}
            sessionId={sessionId}
            onFeedback={handleFeedback}
          />
        </section>

        {showPipeline && (
          <section className="flex min-h-[calc(100vh-7rem)] flex-col rounded-2xl border border-surface-700/80 bg-surface-900/40 p-5 backdrop-blur">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setRightTab("pipeline")} className={tabClass("pipeline")}>
                Pipeline
              </button>
              <button type="button" onClick={() => setRightTab("semantic")} className={tabClass("semantic")}>
                Semantic
              </button>
              <button type="button" onClick={() => setRightTab("guardrails")} className={tabClass("guardrails")}>
                Guardrails
              </button>
            </div>

            <div className="min-h-0 flex-1">
              {rightTab === "pipeline" && (
                <PipelineVisualization
                  steps={pipelineSteps}
                  activeCode={activeCode}
                  sql={activeSql}
                  attachedGuardrails={attachedGuardrails}
                  guardrailChecks={guardrailChecks}
                  validationChecks={validationChecks}
                  sanityWarnings={sanityResult?.warnings ?? []}
                  cacheHit={cacheHit}
                  contextRetrieval={contextRetrieval}
                />
              )}
              {rightTab === "semantic" && <SemanticContextPanel context={semanticContext} />}
              {rightTab === "guardrails" && (
                <GuardrailsPanel
                  guardrails={guardrails}
                  attachedIds={attachedIds}
                  checks={guardrailChecks}
                  onAttachedChange={setAttachedIds}
                  onLibraryChange={setGuardrails}
                />
              )}
            </div>
          </section>
        )}
      </main>
      )}
    </div>
  );
}
