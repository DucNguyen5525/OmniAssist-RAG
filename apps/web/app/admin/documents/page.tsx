"use client";

import type { HelpdeskDocument, ImportSuggestion } from "@helpdesk/shared";
import { Database, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { AdminLayout } from "@/components/AdminLayout";
import { apiClient, getErrorMessage } from "@/lib/api-client";

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<HelpdeskDocument[]>([]);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [tags, setTags] = useState("");
  const [indexJson, setIndexJson] = useState<unknown>();
  const [fileName, setFileName] = useState("");
  const [backupToR2, setBackupToR2] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [suggestion, setSuggestion] = useState<ImportSuggestion>();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  async function loadDocuments() {
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await apiClient.listDocuments();
      setDocuments(response.data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleJsonFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(undefined);
    setSuggestion(undefined);
    setFileName(file.name);

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setIndexJson(undefined);
      setError("The selected file is not valid JSON.");
      return;
    }
    setIndexJson(parsed);

    // AI proposes new-vs-update + metadata; the human reviews and confirms via Import
    setIsAnalyzing(true);
    try {
      const res = await apiClient.analyzeImport({ indexJson: parsed });
      setSuggestion(res.data);
      setTitle(res.data.title);
      setSlug(res.data.slug);
      setTags(res.data.tags.join(", "));
    } catch {
      // analysis is best-effort; the form can still be filled manually
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!indexJson) {
      setError("Select a PageIndex JSON file first.");
      return;
    }

    setIsLoading(true);
    setError(undefined);
    try {
      await apiClient.importPageIndex({
        title,
        slug,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        backupToR2,
        indexJson
      });
      setTitle("");
      setSlug("");
      setTags("");
      setFileName("");
      setIndexJson(undefined);
      setSuggestion(undefined);
      await loadDocuments();
    } catch (err) {
      setError(getErrorMessage(err));
      setIsLoading(false);
    }
  }

  return (
    <AdminLayout>
      <section className="p-5 md:p-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-stone-900">Documents</h1>
          <p className="mt-1 text-sm text-stone-600">Import preprocessed PageIndex JSON into MongoDB.</p>
        </div>

        {isAnalyzing ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            <div className="h-2 w-2 animate-ping rounded-full bg-emerald-500" />
            AI đang phân tích tài liệu để đề xuất cách nhập...
          </div>
        ) : null}

        {suggestion ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex items-center gap-1.5 font-semibold">
              <Sparkles size={14} />
              Đề xuất của AI —{" "}
              {suggestion.action === "update"
                ? `CẬP NHẬT tài liệu đã có "${suggestion.matchedSlug}"`
                : "TẠO TÀI LIỆU MỚI"}
            </div>
            {suggestion.reason ? <p className="mt-1 text-emerald-700">{suggestion.reason}</p> : null}
            <p className="mt-1 text-xs text-emerald-600">
              Các trường bên dưới đã được điền sẵn theo đề xuất. Kiểm tra/chỉnh sửa rồi nhấn Import để xác nhận.
            </p>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mb-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-5 md:grid-cols-2 shadow-xs">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} required className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Slug</span>
            <input value={slug} onChange={(event) => setSlug(event.target.value)} required className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-stone-700">Tags</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="helpdesk,warranty" className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-mint px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-mint/90">
              <Upload size={16} aria-hidden="true" />
              Select JSON
              <input className="hidden" type="file" accept=".json,application/json" onChange={handleJsonFile} />
            </label>
            {fileName ? <span className="text-sm text-stone-600">{fileName}</span> : null}
            <label className="inline-flex items-center gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={backupToR2} onChange={(event) => setBackupToR2(event.target.checked)} className="h-4 w-4 accent-mint" />
              Backup JSON to R2
            </label>
            <button type="submit" disabled={isLoading} className="inline-flex items-center gap-2 rounded-md bg-coral px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-coral/90 disabled:opacity-50">
              <Database size={16} aria-hidden="true" />
              Import
            </button>
          </div>
        </form>

        {error ? <div className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xs">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td className="px-4 py-5 text-stone-500" colSpan={4}>Loading documents...</td></tr>
              ) : documents.length === 0 ? (
                <tr><td className="px-4 py-5 text-stone-500" colSpan={4}>No PageIndex documents imported yet.</td></tr>
              ) : (
                documents.map((document) => (
                  <tr key={document.id} className="border-t border-stone-100 hover:bg-stone-50/50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/documents/${encodeURIComponent(document.slug)}`} className="font-medium text-stone-800 hover:text-mint hover:underline">
                        {document.title}
                      </Link>
                      <div className="text-xs text-stone-500">{document.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{document.tags.join(", ") || "-"}</td>
                    <td className="px-4 py-3"><StatusBadge status={document.status} /></td>
                    <td className="px-4 py-3 text-stone-600">{new Date(document.updatedAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  );
}
