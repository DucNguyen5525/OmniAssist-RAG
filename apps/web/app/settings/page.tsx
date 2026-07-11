"use client";

import { Save } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { defaultSettings, loadSettings, saveSettings } from "@/lib/settings";

export default function SettingsPage() {
  const [topK, setTopK] = useState(defaultSettings.topK);
  const [tags, setTags] = useState(defaultSettings.tags);
  const [retrievalMode, setRetrievalMode] = useState(defaultSettings.retrievalMode);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = loadSettings();
    setTopK(settings.topK);
    setTags(settings.tags);
    setRetrievalMode(settings.retrievalMode);
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    saveSettings({ ...loadSettings(), topK, tags, retrievalMode });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return (
    <AdminLayout>
      <section className="p-5 md:p-8">
        <h1 className="text-xl font-semibold text-stone-900">Settings</h1>
        <p className="mt-1 text-sm text-stone-600">Configure PageIndex retrieval parameter defaults.</p>

        <form onSubmit={handleSubmit} className="mt-5 max-w-xl space-y-5 rounded-xl border border-stone-200 bg-white p-5 shadow-xs">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Top K PageIndex nodes</span>
            <input
              type="number"
              min={1}
              max={12}
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
              className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-stone-700">Tag filter</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="helpdesk,warranty"
              className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-stone-700">Chế độ truy hồi mặc định</span>
            <select
              value={retrievalMode}
              onChange={(event) => setRetrievalMode(event.target.value as typeof retrievalMode)}
              className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint"
            >
              <option value="pageindex">PageIndex (tài liệu văn bản)</option>
              <option value="amg">AMG (dữ liệu bảng)</option>
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              AMG trả lời bằng thống kê tính trực tiếp trên bộ dữ liệu gắn với helpdesk.
            </span>
          </label>

          <div className="rounded-md bg-stone-50 p-3 text-xs text-stone-600">
            Gemini model, MongoDB, and R2 settings are configured on the server through environment variables.
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" className="inline-flex items-center gap-2 rounded-md bg-mint px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-mint/90">
              <Save size={16} aria-hidden="true" />
              Save
            </button>
            {saved ? <span className="text-sm font-medium text-emerald-600">Saved successfully</span> : null}
          </div>
        </form>
      </section>
    </AdminLayout>
  );
}
