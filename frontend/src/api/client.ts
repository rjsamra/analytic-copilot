import type { DisplayPayload, StreamEvent } from "../types";

export interface ChatStreamCallbacks {
  onEvent: (event: StreamEvent) => void;
  onError: (error: string) => void;
}

export async function fetchSampleQuestions(): Promise<string[]> {
  const res = await fetch("/api/sample-questions");
  const data = await res.json();
  return data.questions ?? [];
}

export async function clearSession(sessionId: string): Promise<void> {
  await fetch("/api/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export function streamChat(
  message: string,
  sessionId: string | null,
  showInternalThoughts: boolean,
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
