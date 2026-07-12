"use client";

import { Menu, Trash2 } from "lucide-react";

interface ChatHeaderProps {
  title?: string;
  onOpenSidebar?: () => void;
  onClearChat?: () => void;
  hasMessages: boolean;
}

export function ChatHeader({ title, onOpenSidebar, onClearChat, hasMessages }: ChatHeaderProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white/90 px-4 md:px-6 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        {onOpenSidebar ? (
          <button
            type="button"
            onClick={onOpenSidebar}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 active:scale-[0.98] md:hidden"
            title="Mở thanh bên"
            aria-label="Mở thanh bên"
          >
            <Menu size={15} />
            <span>Menu</span>
          </button>
        ) : null}
        <h1 className="truncate text-sm font-bold text-stone-800 md:text-base">
          {title || "Trợ lý Helpdesk RAG"}
        </h1>
      </div>

      {hasMessages && onClearChat ? (
        <button
          onClick={onClearChat}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
          title="Xóa đoạn chat hiện tại"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">Xóa chat</span>
        </button>
      ) : null}
    </header>
  );
}
