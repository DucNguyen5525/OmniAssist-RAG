"use client";

import type { Helpdesk, HelpdeskDocument } from "@helpdesk/shared";
import {
  Plus,
  MessageSquare,
  Pencil,
  LogOut,
  X,
  Hash,
  Layers,
  Trash2,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { BrandIcon } from "@/components/BrandIcon";
import { apiClient, getErrorMessage } from "@/lib/api-client";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

interface HelpdeskFormData {
  name: string;
  slug: string;
  description: string;
  isPrivate: boolean;
  tags: string;
  topK: number;
  systemPrompt: string;
  retrievalMode: "pageindex" | "amg";
  datasetSlug: string;
  documentSlugs: string[];
}

const defaultForm: HelpdeskFormData = {
  name: "",
  slug: "",
  description: "",
  isPrivate: false,
  tags: "",
  topK: 6,
  systemPrompt: "",
  retrievalMode: "pageindex",
  datasetSlug: "",
  documentSlugs: [],
};

export default function DashboardPage() {
  const router = useRouter();
  const [helpdesks, setHelpdesks] = useState<Helpdesk[]>([]);
  const [documents, setDocuments] = useState<HelpdeskDocument[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [form, setForm] = useState<HelpdeskFormData>(defaultForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const [isDeletingHelpdesk, setIsDeletingHelpdesk] = useState(false);
  const [error, setError] = useState<string>();
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const isEditing = editingSlug !== null;

  function handleOpenCreate() {
    setEditingSlug(null);
    setForm(defaultForm);
    setSlugManuallyEdited(false);
    setError(undefined);
    setShowCreateForm(true);
  }

  function handleOpenEdit(hd: Helpdesk) {
    setEditingSlug(hd.slug);
    setForm({
      name: hd.name,
      slug: hd.slug,
      description: hd.description ?? "",
      isPrivate: hd.isPrivate ?? false,
      tags: (hd.tags ?? []).join(", "),
      topK: hd.topK ?? 6,
      systemPrompt: hd.systemPrompt ?? "",
      retrievalMode: hd.retrievalMode ?? "pageindex",
      datasetSlug: hd.datasetSlug ?? "",
      documentSlugs: hd.documentSlugs ?? [],
    });
    setSlugManuallyEdited(true);
    setError(undefined);
    setShowCreateForm(true);
  }

  function handleCloseForm() {
    setShowCreateForm(false);
    setEditingSlug(null);
    setError(undefined);
  }

  function handleRequestDelete(slug: string) {
    setPendingDeleteSlug(slug);
    setError(undefined);
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteSlug || isDeletingHelpdesk) return;
    setIsDeletingHelpdesk(true);
    setError(undefined);
    try {
      await apiClient.deleteHelpdesk(pendingDeleteSlug);
      setHelpdesks((current) => current.filter((helpdesk) => helpdesk.slug !== pendingDeleteSlug));
      setPendingDeleteSlug(null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsDeletingHelpdesk(false);
    }
  }

  async function fetchHelpdesks() {
    setIsLoadingList(true);
    try {
      const res = await apiClient.listHelpdesks();
      setHelpdesks(res.data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoadingList(false);
    }
  }

  useEffect(() => {
    fetchHelpdesks();
    apiClient
      .listDocuments()
      .then((res) => setDocuments(res.data))
      .catch(() => {
        // document checkboxes are hidden when the list cannot be loaded
      });
  }, []);

  function toggleDocumentSlug(slug: string) {
    setForm((prev) => ({
      ...prev,
      documentSlugs: prev.documentSlugs.includes(slug)
        ? prev.documentSlugs.filter((s) => s !== slug)
        : [...prev.documentSlugs, slug],
    }));
  }

  function handleNameChange(name: string) {
    setForm((prev) => ({
      ...prev,
      name,
      slug: slugManuallyEdited ? prev.slug : slugify(name),
    }));
  }

  function handleSlugChange(slug: string) {
    setSlugManuallyEdited(true);
    setForm((prev) => ({ ...prev, slug }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) return;

    setIsSubmitting(true);
    setError(undefined);

    try {
      const tags = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const datasetSlug =
        form.retrievalMode === "amg" ? form.datasetSlug.trim() || undefined : undefined;
      const documentSlugs = form.retrievalMode === "pageindex" ? form.documentSlugs : [];

      if (isEditing && editingSlug) {
        await apiClient.updateHelpdesk(editingSlug, {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          isPrivate: form.isPrivate,
          tags,
          topK: form.topK,
          systemPrompt: form.systemPrompt.trim() || undefined,
          retrievalMode: form.retrievalMode,
          datasetSlug,
          documentSlugs,
        });
      } else {
        await apiClient.createHelpdesk({
          name: form.name.trim(),
          slug: form.slug.trim(),
          description: form.description.trim() || undefined,
          isPrivate: form.isPrivate,
          tags: tags.length > 0 ? tags : undefined,
          topK: form.topK,
          systemPrompt: form.systemPrompt.trim() || undefined,
          retrievalMode: form.retrievalMode,
          datasetSlug,
          documentSlugs: documentSlugs.length > 0 ? documentSlugs : undefined,
        });
      }

      setShowCreateForm(false);
      setEditingSlug(null);
      setForm(defaultForm);
      setSlugManuallyEdited(false);
      await fetchHelpdesks();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-6">
            {/* Branding */}
            <Link href="/dashboard" className="flex items-center gap-2">
              <BrandIcon />
              <span className="text-sm font-bold tracking-wide text-stone-800">
                Helpdesk RAG
              </span>
            </Link>

            {/* Nav Links */}
            <nav className="hidden items-center gap-1 md:flex">
              {[
                { href: "/dashboard", label: "Dashboard" },
                { href: "/admin/documents", label: "Documents" },
                { href: "/admin/debug", label: "Debug" },
                { href: "/predict/shock-baseline", label: "Dự đoán" },
                { href: "/settings", label: "Cài đặt" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut size={14} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-6">
        {/* Title Row */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              Helpdesks
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              Quản lý các helpdesk và bắt đầu trò chuyện
            </p>
          </div>

          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 rounded-lg bg-mint px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint/90 active:scale-[0.98]"
          >
            <Plus size={16} />
            <span>Tạo Helpdesk mới</span>
          </button>
        </div>

        {/* Error */}
        {error && !showCreateForm && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoadingList && (
          <div className="flex items-center gap-3 py-20 justify-center text-stone-400">
            <div className="h-2 w-2 animate-ping rounded-full bg-mint" />
            <span className="text-sm">Đang tải danh sách helpdesk...</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoadingList && helpdesks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-mint/10">
              <BrandIcon className="h-12 w-12" />
            </div>
            <h2 className="text-lg font-bold text-stone-800">
              Chưa có helpdesk nào
            </h2>
            <p className="mt-2 max-w-sm text-sm text-stone-500">
              Tạo helpdesk đầu tiên để bắt đầu sử dụng hệ thống trợ lý tri
              thức RAG.
            </p>
          </div>
        )}

        {/* Helpdesk Grid */}
        {!isLoadingList && helpdesks.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {helpdesks.map((hd) => (
              <div
                key={hd.id}
                className="group flex flex-col rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition-all hover:border-mint/40 hover:shadow-md"
              >
                {/* Name & Slug */}
                <div className="mb-3">
                  <h3 className="text-base font-bold text-stone-800 group-hover:text-mint transition-colors">
                    {hd.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-stone-400 font-mono">
                    /{hd.slug}
                  </p>
                  {hd.isPrivate ? (
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-stone-900 px-2 py-0.5 text-[11px] font-medium text-white">
                      <Lock size={10} />
                      Private
                    </span>
                  ) : null}
                </div>

                {/* Description */}
                {hd.description && (
                  <p className="mb-3 line-clamp-2 text-sm text-stone-500">
                    {hd.description}
                  </p>
                )}

                {/* Tags */}
                {hd.tags && hd.tags.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {hd.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600"
                      >
                        <Hash size={10} />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Meta */}
                <div className="mb-4 flex items-center gap-3 text-[11px] text-stone-400">
                  <span className="flex items-center gap-1">
                    <Layers size={12} />
                    TopK: {hd.topK}
                  </span>
                </div>

                {/* Actions */}
                <div className="mt-auto flex items-center gap-2 border-t border-stone-100 pt-3">
                  <Link
                    href={`/chat/${hd.slug}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-mint px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-mint/90 active:scale-[0.98]"
                  >
                    <MessageSquare size={14} />
                    Chat
                  </Link>
                  <button
                    onClick={() => handleOpenEdit(hd)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
                    title="Chỉnh sửa helpdesk"
                  >
                    <Pencil size={14} />
                    Sửa
                  </button>
                  <button
                    onClick={() => handleRequestDelete(hd.slug)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                    title="Xóa helpdesk"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Helpdesk Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl">
            {/* Modal Header */}
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">
                {isEditing ? "Chỉnh sửa Helpdesk" : "Tạo Helpdesk mới"}
              </h2>
              <button
                onClick={handleCloseForm}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* Error in Modal */}
            {error && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  Tên Helpdesk <span className="text-coral">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Ví dụ: Hỗ trợ khách hàng ABC"
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </div>

              {/* Slug */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  Slug <span className="text-coral">*</span>
                </label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="ho-tro-khach-hang-abc"
                  required
                  readOnly={isEditing}
                  className={`w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20 ${
                    isEditing ? "cursor-not-allowed bg-stone-100 text-stone-500" : ""
                  }`}
                />
                <p className="mt-1 text-[11px] text-stone-400">
                  {isEditing
                    ? "Slug là định danh cố định, không thể đổi khi chỉnh sửa."
                    : "Tự động tạo từ tên. Có thể chỉnh sửa thủ công."}
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  Mô tả
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Mô tả ngắn về helpdesk này"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 bg-stone-50/70 p-3">
                <input
                  type="checkbox"
                  checked={form.isPrivate}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, isPrivate: e.target.checked }))
                  }
                  className="mt-0.5 h-4 w-4 accent-mint"
                />
                <span>
                  <span className="block text-xs font-medium text-stone-800">Private helpdesk</span>
                  <span className="mt-0.5 block text-[11px] leading-5 text-stone-500">
                    Bật tuỳ chọn này để yêu cầu đăng nhập trước khi xem hoặc chat với helpdesk.
                  </span>
                </span>
              </label>

              {/* Tags */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  Tags
                </label>
                <input
                  type="text"
                  value={form.tags}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, tags: e.target.value }))
                  }
                  placeholder="tag1, tag2, tag3"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
                <p className="mt-1 text-[11px] text-stone-400">
                  Phân cách bằng dấu phẩy
                </p>
              </div>

              {/* TopK */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  Top K
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.topK}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      topK: parseInt(e.target.value) || 6,
                    }))
                  }
                  className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20"
                />
              </div>

              {/* System Prompt */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  System Prompt
                </label>
                <textarea
                  value={form.systemPrompt}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      systemPrompt: e.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Hướng dẫn cho AI trợ lý (tuỳ chọn)"
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20 resize-none"
                />
              </div>

              {/* Retrieval Mode */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-stone-700">
                  Chế độ truy hồi
                </label>
                <select
                  value={form.retrievalMode}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      retrievalMode: e.target.value as HelpdeskFormData["retrievalMode"],
                    }))
                  }
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20"
                >
                  <option value="pageindex">PageIndex (tài liệu văn bản)</option>
                  <option value="amg">AMG (dữ liệu bảng)</option>
                </select>
              </div>

              {/* Document selection — only for PageIndex mode */}
              {form.retrievalMode === "pageindex" && documents.length > 0 && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-stone-700">
                    Tài liệu dùng cho chat
                  </label>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2">
                    {documents.map((doc) => (
                      <label
                        key={doc.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-50"
                      >
                        <input
                          type="checkbox"
                          checked={form.documentSlugs.includes(doc.slug)}
                          onChange={() => toggleDocumentSlug(doc.slug)}
                          className="h-4 w-4 accent-mint"
                        />
                        <span className="flex-1 truncate">{doc.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-stone-400">{doc.slug}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-stone-400">
                    {form.documentSlugs.length > 0
                      ? `Chat chỉ tìm trong ${form.documentSlugs.length} tài liệu đã chọn.`
                      : "Không chọn tài liệu nào: chat sẽ tìm theo tags (hoặc toàn bộ nếu không có tags)."}
                  </p>
                </div>
              )}

              {/* Dataset slug — only for AMG mode */}
              {form.retrievalMode === "amg" && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-stone-700">
                    Dataset slug
                  </label>
                  <input
                    type="text"
                    value={form.datasetSlug}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, datasetSlug: e.target.value }))
                    }
                    placeholder="Để trống nếu trùng slug helpdesk"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono text-stone-800 outline-none transition-colors focus:border-mint focus:ring-2 focus:ring-mint/20"
                  />
                  <p className="mt-1 text-[11px] text-stone-400">
                    Slug của bộ dữ liệu đã nạp bằng <code>npm run import:dataset</code>.
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-stone-100 pt-4">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100"
                >
                  Huỷ
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !form.name.trim() || !form.slug.trim()}
                  className="flex items-center gap-2 rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-mint/90 active:scale-[0.98] disabled:opacity-50"
                >
                  {isSubmitting && (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  )}
                  <span>
                    {isSubmitting
                      ? isEditing
                        ? "Đang lưu..."
                        : "Đang tạo..."
                      : isEditing
                        ? "Lưu thay đổi"
                        : "Tạo Helpdesk"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pendingDeleteSlug ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
            <h2 className="text-base font-bold text-stone-900">Xóa helpdesk?</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Helpdesk &ldquo;{helpdesks.find((helpdesk) => helpdesk.slug === pendingDeleteSlug)?.name ?? pendingDeleteSlug}&rdquo; sẽ bị xóa khỏi dashboard. Tài liệu đã import không bị xóa.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteSlug(null)}
                disabled={isDeletingHelpdesk}
                className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeletingHelpdesk}
                className="flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
              >
                {isDeletingHelpdesk ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <Trash2 size={14} />
                )}
                <span>{isDeletingHelpdesk ? "Đang xóa..." : "Xóa helpdesk"}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
