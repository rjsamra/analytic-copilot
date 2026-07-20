import type {
  DisplayPayload,
  EvalCase,
  Guardrail,
  GuardrailType,
  StreamEvent,
} from "../types";

export interface ChatStreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: string) => void;
}

export async function fetchSampleQuestions(): Promise<string[]> {
  const res = await fetch("/api/sample-questions");
  const data = await res.json();
  return data.questions ?? [];
}

export async function fetchGuardrails(): Promise<Guardrail[]> {
  const res = await fetch("/api/guardrails");
  const data = await res.json();
  return data.guardrails ?? [];
}

export async function upsertGuardrail(payload: {
  id?: string;
  name: string;
  type: GuardrailType;
  description: string;
  config: Record<string, unknown>;
}): Promise<Guardrail> {
  const res = await fetch("/api/guardrails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to save guardrail (${res.status})`);
  }
  const data = await res.json();
  return data.guardrail;
}

export async function deleteGuardrail(id: string): Promise<void> {
  const res = await fetch(`/api/guardrails/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to delete guardrail (${res.status})`);
  }
}

export async function clearSession(sessionId: string): Promise<void> {
  await fetch("/api/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function fetchEvalCases(): Promise<EvalCase[]> {
  const res = await fetch("/api/eval/cases");
  const data = await res.json();
  return data.cases ?? [];
}

export function streamEvalRun(callbacks: ChatStreamCallbacks): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/eval/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        callbacks.onError(`Eval request failed (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6)) as StreamEvent;
          callbacks.onEvent(payload);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError((err as Error).message);
      }
    }
  })();

  return controller;
}

export function streamChat(
  message: string,
  sessionId: string | null,
  showInternalThoughts: boolean,
  attachedGuardrailIds: string[],
  callbacks: ChatStreamCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          session_id: sessionId,
          show_internal_thoughts: showInternalThoughts,
          attached_guardrail_ids: attachedGuardrailIds,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        callbacks.onError(`Request failed (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6)) as StreamEvent;
          callbacks.onEvent(payload);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        callbacks.onError((err as Error).message);
      }
    }
  })();

  return controller;
}

export function displayFromEvent(event: StreamEvent): DisplayPayload | null {
  return event.display ?? null;
}
