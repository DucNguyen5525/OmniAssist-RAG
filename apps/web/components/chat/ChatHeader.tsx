"use client";

import { Sparkles, Trash2, Layers } from "lucide-react";

interface ChatHeaderProps {
  title?: string;
  onClearChat?: () => void;
  hasMessages: boolean;
  models?: string[];
  selectedModel?: string;
  onSelectModel?: (model: string) => void;
}

export function ChatHeader({ title, onClearChat, hasMessages, models, selectedModel, onSelectModel }: ChatHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white/90 px-4 md:px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3 overflow-hidden">
        <h1 className="truncate text-sm font-bold text-stone-800 md:text-base">
          {title || "Trợ lý Helpdesk RAG"}
        </h1>

        {models && models.length > 0 && onSelectModel ? (
          <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200/60">
            <Sparkles size={12} className="text-emerald-600" />
            <select
              value={selectedModel}
              onChange={(event) => onSelectModel(event.target.value)}
              className="cursor-pointer bg-transparent text-[11px] font-medium text-emerald-700 outline-none"
              title="Chọn model AI trả lời"
            >
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="hidden md:flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 border border-stone-200">
          <Layers size={12} />
          <span>PageIndex RAG</span>
        </div>
      </div>

      {hasMessages && onClearChat ? (
        <button
          onClick={onClearChat}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
          title="Xóa đoạn chat hiện tại"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">Clear Chat</span>
        </button>
      ) : null}
    </header>
  );
}
