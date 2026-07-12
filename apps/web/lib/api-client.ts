import type { ChatMessage, ChatResponse, ChatSession, ChatStreamEvent, Helpdesk, HelpdeskDocument, ImportSuggestion, MessageFeedback, ModelsInfo, PredictionModelInfo, PredictionResult, RetrievalDebugResponse, RetrievalMode, RetrievalResponseItem } from "@helpdesk/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(`API error ${status}`);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 422) return "Please check the input and try again.";
    if (error.status === 404) return "The requested item was not found.";
    if (error.status === 429) return "This chat session has reached its question limit. Please start a new session.";
    return "The server could not complete the request.";
  }
  if (error instanceof TypeError) return "Cannot connect to the API server.";
  return "Something went wrong.";
}

export const apiClient = {
  listDocuments: () => request<{ data: HelpdeskDocument[] }>("/api/documents"),
  importPageIndex: (body: {
    title: string;
    slug: string;
    tags?: string[];
    version?: string;
    sourceFileUrl?: string;
    indexFileUrl?: string;
    backupToR2?: boolean;
    indexJson: unknown;
  }) =>
    request<{ data: HelpdeskDocument }>("/api/documents/import", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  ask: (body: { question: string; conversationId?: string; tags?: string[]; topK?: number; helpdeskSlug?: string; retrievalMode?: RetrievalMode; model?: string }) =>
    request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  // Streaming chat: reads NDJSON events from /api/chat and forwards each one to onEvent.
  askStream: async (
    body: { question: string; conversationId?: string; tags?: string[]; topK?: number; helpdeskSlug?: string; retrievalMode?: RetrievalMode; model?: string },
    onEvent: (event: ChatStreamEvent) => void
  ): Promise<void> => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!res.ok || !res.body) {
      const errBody = await res.json().catch(() => null);
      throw new ApiError(res.status, errBody);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const emitLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        onEvent(JSON.parse(trimmed) as ChatStreamEvent);
      } catch {
        // ignore malformed lines
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(emitLine);
    }
    emitLine(buffer);
  },
  setMessageFeedback: (messageId: string, feedback: MessageFeedback | null) =>
    request<{ ok: boolean }>(`/api/chat/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ feedback })
    }),
  listModels: () => request<{ data: ModelsInfo }>("/api/models"),
  analyzeImport: (body: { indexJson: unknown }) =>
    request<{ data: ImportSuggestion }>("/api/documents/analyze", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  retrieve: (body: { query: string; tags?: string[]; topK?: number }) =>
    request<{ data: RetrievalResponseItem[] }>("/api/chat/retrieve", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  debugRetrieval: (body: { question: string; helpdeskSlug?: string; tags?: string[]; topK?: number; top?: number; noRoute?: boolean; model?: string }) =>
    request<{ data: RetrievalDebugResponse }>("/api/chat/debug", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  getPredictionModel: (slug: string) =>
    request<{ data: PredictionModelInfo }>(`/api/predict?model=${encodeURIComponent(slug)}`),
  predict: (body: { modelSlug?: string; features: Record<string, string | number | null> }) =>
    request<{ data: PredictionResult }>("/api/predict", { method: "POST", body: JSON.stringify(body) }),
  listSessions: () => request<{ data: ChatSession[] }>("/api/chat/sessions"),
  listMessages: (conversationId: string) =>
    request<{ data: ChatMessage[] }>(`/api/chat/sessions/${conversationId}/messages`),
  deleteSession: (conversationId: string) =>
    request<void>(`/api/chat/sessions/${conversationId}`, { method: "DELETE" }),

  // Auth
  login: (body: { username: string; password: string; rememberMe?: boolean }) =>
    request<{ ok: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify(body) }),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  checkAuth: () =>
    request<{ authenticated: boolean }>("/api/auth/check"),

  // Helpdesks
  listHelpdesks: () =>
    request<{ data: Helpdesk[] }>("/api/helpdesks"),
  createHelpdesk: (body: { name: string; slug: string; description?: string; tags?: string[]; topK?: number; systemPrompt?: string; model?: string; retrievalMode?: RetrievalMode; datasetSlug?: string; documentSlugs?: string[] }) =>
    request<{ data: Helpdesk }>("/api/helpdesks", { method: "POST", body: JSON.stringify(body) }),
  getHelpdesk: (slug: string) =>
    request<{ data: Helpdesk }>(`/api/helpdesks/${slug}`),
  updateHelpdesk: (slug: string, body: Record<string, unknown>) =>
    request<{ data: Helpdesk }>(`/api/helpdesks/${slug}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteHelpdesk: (slug: string) =>
    request<void>(`/api/helpdesks/${slug}`, { method: "DELETE" }),
};
