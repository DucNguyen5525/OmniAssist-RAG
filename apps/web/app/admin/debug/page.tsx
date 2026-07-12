"use client";

import type { Helpdesk, RetrievalDebugResponse } from "@helpdesk/shared";
import { Search } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { apiClient, getErrorMessage } from "@/lib/api-client";
import { loadSettings, parseTags } from "@/lib/settings";

export default function DebugPage() {
  const [query, setQuery] = useState("");
  const [helpdesks, setHelpdesks] = useState<Helpdesk[]>([]);
  const [helpdeskSlug, setHelpdeskSlug] = useState("");
  const [top, setTop] = useState(25);
  const [noRoute, setNoRoute] = useState(false);
  const [result, setResult] = useState<RetrievalDebugResponse>();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHelpdesks, setIsLoadingHelpdesks] = useState(false);
  const [error, setError] = useState<string>();
  const settings = useMemo(() => loadSettings(), []);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingHelpdesks(true);
    apiClient.listHelpdesks()
      .then((response) => {
        if (!isMounted) return;
        setHelpdesks(response.data);
        setHelpdeskSlug((current) => current || response.data[0]?.slug || "");
      })
      .catch((err) => {
        if (isMounted) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (isMounted) setIsLoadingHelpdesks(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(undefined);
    try {
      const response = await apiClient.debugRetrieval({
        question: query.trim(),
        helpdeskSlug: helpdeskSlug || undefined,
        topK: helpdeskSlug ? undefined : settings.topK,
        tags: helpdeskSlug ? undefined : parseTags(settings.tags),
        top,
        noRoute
      });
      setResult(response.data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AdminLayout>
      <section className="p-5 md:p-8">
        <h1 className="text-xl font-semibold text-stone-900">Retrieval Debug</h1>

        <form onSubmit={handleSubmit} className="mt-5 max-w-6xl rounded-lg border border-stone-200 bg-white p-4 shadow-xs">
          <div className="grid gap-3 lg:grid-cols-[minmax(180px,240px)_1fr_120px_auto_auto]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Helpdesk</span>
              <select
                value={helpdeskSlug}
                onChange={(event) => setHelpdeskSlug(event.target.value)}
                disabled={isLoadingHelpdesks}
                className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-mint disabled:opacity-60"
              >
                <option value="">Global settings</option>
                {helpdesks.map((helpdesk) => (
                  <option key={helpdesk.slug} value={helpdesk.slug}>
                    {helpdesk.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Question</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-mint"
                placeholder="Enter a PageIndex retrieval query"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-500">Rows</span>
              <input
                type="number"
                min={1}
                max={100}
                value={top}
                onChange={(event) => setTop(Number(event.target.value) || 25)}
                className="h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm outline-none focus:border-mint"
              />
            </label>
            <label className="flex h-full items-end gap-2 pb-3 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={noRoute}
                onChange={(event) => setNoRoute(event.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-mint focus:ring-mint"
              />
              No route
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-coral text-white shadow-xs hover:bg-coral/90 disabled:opacity-50"
                title="Search"
              >
                <Search size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>

        {error ? <div className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {isLoading ? <div className="mt-5 text-sm text-stone-500">Running retrieval debug...</div> : null}

        {result ? (
          <div className="mt-5 space-y-5">
            <section className="grid gap-3 lg:grid-cols-3">
              <Metric label="Routing" value={formatRouting(result.routing.status)} />
              <Metric label="Routed docs" value={result.routing.routedSlugs.join(", ") || "none"} />
              <Metric label="Selected nodes" value={`${result.selectedCount}/${result.scope.topK}`} />
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-xs">
              <h2 className="text-sm font-semibold text-stone-900">Candidate Documents</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Slug</th>
                      <th className="py-2 pr-4 font-medium">Title</th>
                      <th className="py-2 pr-4 font-medium">Summary</th>
                      <th className="py-2 pr-4 font-medium">Routed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {result.candidates.map((doc) => (
                      <tr key={doc.slug}>
                        <td className="py-2 pr-4 font-mono text-xs text-stone-700">{doc.slug}</td>
                        <td className="py-2 pr-4 text-stone-800">{doc.title}</td>
                        <td className="py-2 pr-4 text-stone-600">{doc.hasSummary ? "yes" : "no"}</td>
                        <td className="py-2 pr-4 text-stone-600">{doc.routed ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-stone-900">Scored Nodes</h2>
                <span className="text-xs text-stone-500">Showing {result.nodes.length} of {result.totalScoredNodes}</span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Use</th>
                      <th className="py-2 pr-3 font-medium">Score</th>
                      <th className="py-2 pr-3 font-medium">Doc</th>
                      <th className="py-2 pr-3 font-medium">Level</th>
                      <th className="py-2 pr-3 font-medium">Node</th>
                      <th className="py-2 pr-3 font-medium">Path</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {result.nodes.map((node) => (
                      <tr key={`${node.documentSlug}-${node.nodeId}`} className={node.selected ? "bg-mint/5" : undefined}>
                        <td className="py-2 pr-3 font-mono text-xs text-stone-700">{node.selected ? "yes" : ""}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-stone-800">{node.score.toFixed(1)}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-stone-700">{node.documentSlug}</td>
                        <td className="py-2 pr-3 text-stone-600">L{node.level}</td>
                        <td className="py-2 pr-3 text-stone-800">{node.nodeTitle}</td>
                        <td className="py-2 pr-3 text-stone-600">{node.path.join(" > ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-xs">
              <h2 className="text-sm font-semibold text-stone-900">Node Details</h2>
              <div className="mt-3 space-y-3">
                {result.nodes.map((node) => (
                  <article key={`${node.documentSlug}-${node.nodeId}-detail`} className="rounded-md border border-stone-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <span className="font-semibold text-stone-700">#{node.rank}</span>
                      <span className="font-mono">score {node.score.toFixed(1)}</span>
                      {node.selected ? <span className="rounded bg-mint px-1.5 py-0.5 font-medium text-white">selected</span> : null}
                      <span>{node.documentTitle}</span>
                      {node.pageStart ? <span>pages {node.pageStart}{node.pageEnd ? `-${node.pageEnd}` : ""}</span> : null}
                    </div>
                    <h3 className="text-sm font-semibold text-stone-900">{node.nodeTitle}</h3>
                    {node.summary ? <p className="mt-2 text-sm font-medium text-stone-700">{node.summary}</p> : null}
                    <p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-stone-700">{node.content}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-xs">
              <h2 className="text-sm font-semibold text-stone-900">Final Prompt</h2>
              <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-stone-950 p-4 text-xs leading-5 text-stone-100">
                {result.prompt}
              </pre>
            </section>
          </div>
        ) : null}
      </section>
    </AdminLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-xs">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-stone-900">{value}</div>
    </div>
  );
}

function formatRouting(status: RetrievalDebugResponse["routing"]["status"]) {
  if (status === "no_candidates") return "No candidates";
  if (status === "skipped_no_route") return "Skipped";
  if (status === "skipped_single_candidate") return "Single candidate";
  return "LLM routed";
}
