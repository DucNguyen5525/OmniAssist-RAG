"use client";

import type { ChatSession, Helpdesk, MessageFeedback, SourceReference } from "@helpdesk/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInputBar } from "@/components/chat/ChatInputBar";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ApiError, apiClient, getErrorMessage } from "@/lib/api-client";
import { loadSettings, parseTags, saveSettings } from "@/lib/settings";

interface UiMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  feedback?: MessageFeedback | null;
  isStreaming?: boolean;
}

export default function HelpdeskChatPage() {
  const params = useParams();
  const router = useRouter();
  const helpdeskSlug = params.helpdeskSlug as string;

  const [helpdesk, setHelpdesk] = useState<Helpdesk | null>(null);
  const [helpdeskError, setHelpdeskError] = useState<string>();
  const [isLoadingHelpdesk, setIsLoadingHelpdesk] = useState(true);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [isDeleting, setIsDeleting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const settings = useMemo(() => loadSettings(), []);

  // Load model list from server; keep saved choice if still allowed
  useEffect(() => {
    async function loadModels() {
      try {
        const res = await apiClient.listModels();
        setModels(res.data.models);
        const saved = settings.model;
        setSelectedModel(saved && res.data.models.includes(saved) ? saved : res.data.defaultModel);
      } catch {
        // model selector stays hidden when the list cannot be loaded
      }
    }
    loadModels();
  }, [settings]);

  function handleSelectModel(model: string) {
    setSelectedModel(model);
    saveSettings({ ...loadSettings(), model });
  }

  // Fetch helpdesk details
  useEffect(() => {
    async function loadHelpdesk() {
      setIsLoadingHelpdesk(true);
      try {
        const res = await apiClient.getHelpdesk(helpdeskSlug);
        setHelpdesk(res.data);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.push(`/login?next=${encodeURIComponent(`/chat/${helpdeskSlug}`)}`);
          return;
        }
        setHelpdeskError(getErrorMessage(err));
      } finally {
        setIsLoadingHelpdesk(false);
      }
    }
    loadHelpdesk();
  }, [helpdeskSlug, router]);

  // Fetch session history list
  async function fetchSessions() {
    try {
      const res = await apiClient.listSessions();
      setSessions(res.data);
    } catch {
      // ignore list session error in background
    }
  }

  useEffect(() => {
    fetchSessions();
  }, []);

  // Auto scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Handle selecting a past session
  async function handleSelectSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      setIsMobileSidebarOpen(false);
      return;
    }
    setActiveSessionId(sessionId);
    setIsMobileSidebarOpen(false);
    setError(undefined);
    setIsLoading(true);
    try {
      const res = await apiClient.listMessages(sessionId);
      setMessages(
        res.data.map((m) => ({
          id: m.id,
          role: m.role === "system" ? "assistant" : m.role,
          content: m.content,
          sources: m.sources,
          feedback: m.feedback,
        }))
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  // Handle starting a new chat
  function handleNewChat() {
    setActiveSessionId(undefined);
    setIsMobileSidebarOpen(false);
    setMessages([]);
    setQuestion("");
    setError(undefined);
  }

  // Delete flow: open confirmation, then remove the session from DB + UI
  function handleRequestDelete(sessionId?: string) {
    if (sessionId) {
      setPendingDeleteId(sessionId);
    } else {
      // current chat has no saved session yet — just reset the view
      handleNewChat();
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId || isDeleting) return;
    setIsDeleting(true);
    try {
      await apiClient.deleteSession(pendingDeleteId);
      setSessions((current) => current.filter((s) => s.id !== pendingDeleteId));
      if (pendingDeleteId === activeSessionId) handleNewChat();
      setPendingDeleteId(undefined);
    } catch (err) {
      setError(getErrorMessage(err));
      setPendingDeleteId(undefined);
    } finally {
      setIsDeleting(false);
    }
  }

  // Handle submitting a user question
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isLoading) return;

    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setError(undefined);
    setIsLoading(true);

    try {
      let streamConversationId: string | undefined;
      let streamSources: SourceReference[] = [];
      let streamDone = false;

      // Updates the assistant message currently being streamed (always the last one)
      const patchLastAssistant = (patch: Partial<UiMessage> | ((last: UiMessage) => Partial<UiMessage>)) => {
        setMessages((current) => {
          const last = current[current.length - 1];
          if (!last || last.role !== "assistant") return current;
          const resolved = typeof patch === "function" ? patch(last) : patch;
          return [...current.slice(0, -1), { ...last, ...resolved }];
        });
      };

      await apiClient.askStream(
        {
          question: trimmed,
          conversationId: activeSessionId,
          topK: helpdesk?.topK ?? settings.topK,
          tags: helpdesk?.tags?.length ? helpdesk.tags : parseTags(settings.tags),
          helpdeskSlug,
          retrievalMode: helpdesk?.retrievalMode ?? settings.retrievalMode,
          model: selectedModel || undefined,
        },
        (event) => {
          if (event.type === "meta") {
            streamConversationId = event.conversationId;
            streamSources = event.sources;
            setMessages((current) => [...current, { role: "assistant", content: "", isStreaming: true }]);
          } else if (event.type === "delta") {
            patchLastAssistant((last) => ({ content: last.content + event.text }));
          } else if (event.type === "done") {
            streamDone = true;
            patchLastAssistant({ id: event.messageId, sources: streamSources, isStreaming: false });
          } else if (event.type === "error") {
            patchLastAssistant({ isStreaming: false });
            setError(event.message);
          }
        }
      );

      if (!streamDone) {
        patchLastAssistant({ sources: streamSources, isStreaming: false });
      }

      if (!activeSessionId && streamConversationId) {
        setActiveSessionId(streamConversationId);
        await fetchSessions();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/chat/${helpdeskSlug}`)}`);
        return;
      }
      setMessages((current) => {
        const last = current[current.length - 1];
        if (!last || last.role !== "assistant" || !last.isStreaming) return current;
        return [...current.slice(0, -1), { ...last, isStreaming: false }];
      });
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  // Optimistic feedback toggle persisted through the messages API
  async function handleFeedback(messageId: string, feedback: MessageFeedback | null) {
    setMessages((current) => current.map((m) => (m.id === messageId ? { ...m, feedback } : m)));
    try {
      await apiClient.setMessageFeedback(messageId, feedback);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Loading state for helpdesk
  if (isLoadingHelpdesk) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50">
        <div className="flex items-center gap-3 text-stone-400">
          <div className="h-2 w-2 animate-ping rounded-full bg-mint" />
          <span className="text-sm">Đang tải helpdesk...</span>
        </div>
      </div>
    );
  }

  // Error / Not found state
  if (helpdeskError || !helpdesk) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-stone-50 p-6 text-center">
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          <p className="font-semibold mb-1">Không tìm thấy helpdesk</p>
          <p>{helpdeskError || `Helpdesk "${helpdeskSlug}" không tồn tại.`}</p>
        </div>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-mint/90"
        >
          <ArrowLeft size={16} />
          Quay lại Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-stone-50">
      {/* Sidebar (Chatbot UI style) */}
      {isMobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-stone-900/40 md:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-label="Đóng thanh bên"
        />
      ) : null}
      <div className={`fixed inset-y-0 left-0 z-40 md:static md:z-auto md:flex ${isMobileSidebarOpen ? "flex" : "hidden md:flex"}`}>
        <ChatSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleRequestDelete}
          onNewChat={handleNewChat}
          collapsed={isMobileSidebarOpen ? false : sidebarCollapsed}
          onToggleCollapse={() => {
            if (isMobileSidebarOpen) {
              setIsMobileSidebarOpen(false);
              return;
            }
            setSidebarCollapsed((prev) => !prev);
          }}
          isMobileDrawer={isMobileSidebarOpen}
        />
      </div>

      {/* Main Workspace */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white">
        <ChatHeader
          title={activeSession?.title || helpdesk.name}
          onOpenSidebar={() => setIsMobileSidebarOpen(true)}
          onClearChat={messages.length > 0 ? () => handleRequestDelete(activeSessionId) : undefined}
          hasMessages={messages.length > 0}
        />

        {/* Dashboard back link */}
        <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50/50 px-4 py-1.5 text-xs text-stone-500">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-mint hover:underline"
          >
            <ArrowLeft size={12} />
            Quay lại Dashboard
          </Link>
          <span className="text-stone-300">·</span>
          <span className="font-medium text-stone-600">{helpdesk.name}</span>
          {helpdesk.description && (
            <>
              <span className="text-stone-300">·</span>
              <span className="truncate">{helpdesk.description}</span>
            </>
          )}
        </div>

        {/* Message Container */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <ChatEmptyState
              helpdeskName={helpdesk.name}
              helpdeskDescription={helpdesk.description}
            />
          ) : (
            <div className="divide-y divide-stone-100 pb-6">
              {messages.map((msg, idx) => (
                <ChatMessageItem
                  key={msg.id || idx}
                  role={msg.role}
                  content={msg.content}
                  sources={msg.sources}
                  messageId={msg.id}
                  feedback={msg.feedback}
                  isStreaming={msg.isStreaming}
                  onFeedback={msg.role === "assistant" ? handleFeedback : undefined}
                />
              ))}

              {isLoading && messages[messages.length - 1]?.role === "user" ? (
                <div className="flex items-center gap-3 bg-stone-50/50 py-5 px-6 max-w-4xl mx-auto text-sm text-stone-500">
                  <div className="flex h-2 w-2 animate-ping rounded-full bg-mint" />
                  <span>Đang tìm kiếm tài liệu & tạo câu trả lời...</span>
                </div>
              ) : null}

              {error ? (
                <div className="mx-auto max-w-4xl p-4">
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                    {error}
                  </div>
                </div>
              ) : null}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <ChatInputBar
          question={question}
          setQuestion={setQuestion}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
        />

        {/* Delete confirmation modal */}
        {pendingDeleteId ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4">
            <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-5 shadow-lg">
              <h3 className="text-sm font-semibold text-stone-900">Xóa đoạn chat?</h3>
              <p className="mt-1.5 text-sm text-stone-600">
                Đoạn chat &ldquo;{sessions.find((s) => s.id === pendingDeleteId)?.title ?? ""}&rdquo; và toàn bộ tin nhắn sẽ bị
                xóa vĩnh viễn.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setPendingDeleteId(undefined)}
                  disabled={isDeleting}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                >
                  {isDeleting ? "Đang xóa..." : "Xóa"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
