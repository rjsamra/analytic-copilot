import type { DisplayPayload, GuardrailType, StreamEvent } from "../types";

export interface ChatStreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: string) => void;
}

export interface ClarificationResponsePayload {
  clarification_id: string;
  option_id: string;
  metric_id?: string;
}

export async function fetchSampleQuestions(): Promise<string[]> {
  const res = await fetch("/api/sample-questions");
  const data = await res.json();
  return data.questions ?? [];
}

export async function fetchGuardrails(): Promise<import("../types").Guardrail[]> {
  const res = await fetch("/api/guardrails");
  const data = await res.json();
  return data.guardrails ?? [];
}

export async function fetchUserProfiles(): Promise<import("../types").UserProfile[]> {
  const res = await fetch("/api/user-profiles");
  const data = await res.json();
  return data.profiles ?? [];
}

export async function upsertGuardrail(payload: {
  id?: string;
  name: string;
  type: GuardrailType;
  description: string;
  config: Record<string, unknown>;
}): Promise<import("../types").Guardrail> {
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

export async function submitFeedback(
  sessionId: string,
  messageId: string,
  verdict: "correct" | "wrong_metric" | "wrong_scope",
  note?: string,
): Promise<{ ok: boolean; cached: boolean; message?: string }> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message_id: messageId, verdict, note }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Feedback failed (${res.status})`);
  }
  return res.json();
}

export async function fetchApprovals(
  status?: string,
): Promise<{ proposals: import("../types").MetricProposal[]; pending_count: number }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/approvals${qs}`);
  if (!res.ok) {
    throw new Error(`Failed to load approvals (${res.status})`);
  }
  return res.json();
}

export async function updateApproval(
  id: string,
  payload: {
    proposed_sql?: string;
    draft_metric?: Partial<import("../types").DraftMetric>;
  },
): Promise<import("../types").MetricProposal> {
  const res = await fetch(`/api/approvals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to update proposal (${res.status})`);
  }
  const data = await res.json();
  return data.proposal;
}

export async function approveApproval(
  id: string,
): Promise<{ proposal: import("../types").MetricProposal; pending_count: number }> {
  const res = await fetch(`/api/approvals/${id}/approve`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to approve (${res.status})`);
  }
  return res.json();
}

export async function rejectApproval(
  id: string,
  reason = "",
): Promise<{ proposal: import("../types").MetricProposal; pending_count: number }> {
  const res = await fetch(`/api/approvals/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to reject (${res.status})`);
  }
  return res.json();
}

export function streamChat(
  message: string,
  sessionId: string | null,
  showInternalThoughts: boolean,
  attachedGuardrailIds: string[],
  userProfileId: string,
  clarificationResponse: ClarificationResponsePayload | null,
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
          user_profile_id: userProfileId,
          clarification_response: clarificationResponse,
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
