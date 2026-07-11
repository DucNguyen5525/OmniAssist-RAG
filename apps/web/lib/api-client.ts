import type { ChatMessage, ChatResponse, ChatSession, Helpdesk, HelpdeskDocument, ModelsInfo, RetrievalMode, RetrievalResponseItem } from "@helpdesk/shared";

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
  listModels: () => request<{ data: ModelsInfo }>("/api/models"),
  retrieve: (body: { query: string; tags?: string[]; topK?: number }) =>
    request<{ data: RetrievalResponseItem[] }>("/api/chat/retrieve", {
      method: "POST",
      body: JSON.stringify(body)
    }),
  listSessions: () => request<{ data: ChatSession[] }>("/api/chat/sessions"),
  listMessages: (conversationId: string) =>
    request<{ data: ChatMessage[] }>(`/api/chat/sessions/${conversationId}/messages`),

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
  createHelpdesk: (body: { name: string; slug: string; description?: string; tags?: string[]; topK?: number; systemPrompt?: string; model?: string; retrievalMode?: RetrievalMode; datasetSlug?: string }) =>
    request<{ data: Helpdesk }>("/api/helpdesks", { method: "POST", body: JSON.stringify(body) }),
  getHelpdesk: (slug: string) =>
    request<{ data: Helpdesk }>(`/api/helpdesks/${slug}`),
  updateHelpdesk: (slug: string, body: Record<string, unknown>) =>
    request<{ data: Helpdesk }>(`/api/helpdesks/${slug}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteHelpdesk: (slug: string) =>
    request<void>(`/api/helpdesks/${slug}`, { method: "DELETE" }),
};
