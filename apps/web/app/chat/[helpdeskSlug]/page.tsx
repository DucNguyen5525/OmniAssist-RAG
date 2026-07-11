"use client";

import type { ChatSession, Helpdesk, SourceReference } from "@helpdesk/shared";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatInputBar } from "@/components/chat/ChatInputBar";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { apiClient, getErrorMessage } from "@/lib/api-client";
import { loadSettings, parseTags, saveSettings } from "@/lib/settings";

interface UiMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
}

export default function HelpdeskChatPage() {
  const params = useParams();
  const helpdeskSlug = params.helpdeskSlug as string;

  const [helpdesk, setHelpdesk] = useState<Helpdesk | null>(null);
  const [helpdeskError, setHelpdeskError] = useState<string>();
  const [isLoadingHelpdesk, setIsLoadingHelpdesk] = useState(true);

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
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
        setHelpdeskError(getErrorMessage(err));
      } finally {
        setIsLoadingHelpdesk(false);
      }
    }
    loadHelpdesk();
  }, [helpdeskSlug]);

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
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
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
    setMessages([]);
    setQuestion("");
    setError(undefined);
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
      const response = await apiClient.ask({
        question: trimmed,
        conversationId: activeSessionId,
        topK: helpdesk?.topK ?? settings.topK,
        tags: helpdesk?.tags?.length ? helpdesk.tags : parseTags(settings.tags),
        helpdeskSlug,
        retrievalMode: helpdesk?.retrievalMode ?? settings.retrievalMode,
        model: selectedModel || undefined,
      });

      if (!activeSessionId) {
        setActiveSessionId(response.conversationId);
        await fetchSessions();
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: response.answer, sources: response.sources },
      ]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  // Handle prompt starter selection
  function handleSelectPrompt(promptText: string) {
    setQuestion(promptText);
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Loading state for helpdesk
  if (isLoadingHelpdesk) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-50">
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
      <div className="flex h-screen flex-col items-center justify-center bg-stone-50 p-6 text-center">
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
    <div className="flex h-screen w-full overflow-hidden bg-stone-50">
      {/* Sidebar (Chatbot UI style) */}
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      >
        {/* Dashboard link in sidebar footer — passed as children */}
      </ChatSidebar>

      {/* Main Workspace */}
      <main className="flex flex-1 flex-col overflow-hidden bg-white">
        <ChatHeader
          title={activeSession?.title || helpdesk.name}
          onClearChat={messages.length > 0 ? handleNewChat : undefined}
          hasMessages={messages.length > 0}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
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
              onSelectPrompt={handleSelectPrompt}
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
                />
              ))}

              {isLoading ? (
                <div className="flex items-center gap-3 bg-stone-50/50 py-5 px-6 max-w-4xl mx-auto text-sm text-stone-500">
                  <div className="flex h-2 w-2 animate-ping rounded-full bg-mint" />
                  <span>Đang tìm kiếm PageIndex & tạo câu trả lời...</span>
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
          topK={helpdesk.topK ?? settings.topK}
          tags={helpdesk.tags?.join(", ") || settings.tags}
        />
      </main>
    </div>
  );
}
