"use client";

import type { HelpdeskDocument, PageIndexNode } from "@helpdesk/shared";
import { ArrowLeft, ChevronDown, ChevronRight, Download, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AdminLayout } from "@/components/AdminLayout";
import { apiClient, getErrorMessage } from "@/lib/api-client";

const CONTENT_PLACEHOLDER = `Mô tả ngắn gọn nội dung mục này...

| Cột 1 | Cột 2 |
| --- | --- |
| Giá trị | Giá trị |`;

export default function DocumentDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = decodeURIComponent(params.slug);

  const [doc, setDoc] = useState<HelpdeskDocument>();
  const [nodes, setNodes] = useState<PageIndexNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // document metadata form
  const [metaTitle, setMetaTitle] = useState("");
  const [metaTags, setMetaTags] = useState("");
  const [metaVersion, setMetaVersion] = useState("");
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // editor state: edit an existing node, or add a child under addParentId (undefined = root)
  const [mode, setMode] = useState<"edit" | "add">("edit");
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [addParentId, setAddParentId] = useState<string>();
  const [nodeTitle, setNodeTitle] = useState("");
  const [nodeSummary, setNodeSummary] = useState("");
  const [nodeContent, setNodeContent] = useState("");
  const [isSavingNode, setIsSavingNode] = useState(false);

  const byId = useMemo(() => new Map(nodes.map((node) => [node.nodeId, node])), [nodes]);
  const selectedNode = selectedNodeId ? byId.get(selectedNodeId) : undefined;
  const isDirty =
    mode === "edit" && selectedNode
      ? nodeTitle !== selectedNode.title || nodeSummary !== (selectedNode.summary ?? "") || nodeContent !== selectedNode.content
      : mode === "add" && (nodeTitle.trim() !== "" || nodeContent.trim() !== "");

  // children grouped by parent, ordered by the parent's childrenIds
  const childrenMap = useMemo(() => {
    const grouped = new Map<string, PageIndexNode[]>();
    for (const node of nodes) {
      const parentId = node.parentNodeId && byId.has(node.parentNodeId) ? node.parentNodeId : "";
      const list = grouped.get(parentId) ?? [];
      list.push(node);
      grouped.set(parentId, list);
    }
    for (const [parentId, children] of grouped) {
      const order = parentId ? byId.get(parentId)?.childrenIds ?? [] : [];
      const rank = (node: PageIndexNode) => {
        const index = order.indexOf(node.nodeId);
        return index === -1 ? order.length : index;
      };
      grouped.set(parentId, [...children].sort((a, b) => rank(a) - rank(b)));
    }
    return grouped;
  }, [nodes, byId]);

  const searchMatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return undefined;
    return nodes.filter((node) => node.title.toLowerCase().includes(query) || node.nodeId.toLowerCase().includes(query));
  }, [nodes, search]);

  async function loadAll() {
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await apiClient.listDocumentNodes(slug);
      setDoc(response.data.document);
      setNodes(response.data.nodes);
      setMetaTitle(response.data.document.title);
      setMetaTags(response.data.document.tags.join(", "));
      setMetaVersion(response.data.document.version ?? "");
      // expand the first two levels by default
      setExpanded(new Set(response.data.nodes.filter((node) => node.level <= 2).map((node) => node.nodeId)));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  function confirmDiscardIfDirty() {
    if (!isDirty) return true;
    return window.confirm("Bạn có thay đổi chưa lưu. Bỏ thay đổi và tiếp tục?");
  }

  function handleSelect(node: PageIndexNode) {
    if (!confirmDiscardIfDirty()) return;
    setMode("edit");
    setSelectedNodeId(node.nodeId);
    setNodeTitle(node.title);
    setNodeSummary(node.summary ?? "");
    setNodeContent(node.content);
    setNotice(undefined);
  }

  function handleStartAdd(parentId?: string) {
    if (!confirmDiscardIfDirty()) return;
    setMode("add");
    setAddParentId(parentId);
    setSelectedNodeId(undefined);
    setNodeTitle("");
    setNodeSummary("");
    setNodeContent("");
    setNotice(undefined);
    if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
  }

  async function handleSubmitNode(event: FormEvent) {
    event.preventDefault();
    setIsSavingNode(true);
    setError(undefined);
    try {
      if (mode === "edit" && selectedNode) {
        const response = await apiClient.updateDocumentNode(slug, selectedNode.nodeId, {
          title: nodeTitle,
          summary: nodeSummary,
          content: nodeContent
        });
        // a title change also rewrites descendant paths server-side, so reload the whole list
        if (response.data.title !== selectedNode.title) {
          await loadAll();
          setSelectedNodeId(response.data.nodeId);
        } else {
          setNodes((prev) => prev.map((node) => (node.nodeId === response.data.nodeId ? response.data : node)));
        }
        setNotice("Đã lưu node.");
      } else {
        const response = await apiClient.createDocumentNode(slug, {
          parentNodeId: addParentId,
          title: nodeTitle,
          summary: nodeSummary.trim() ? nodeSummary : undefined,
          content: nodeContent
        });
        await loadAll();
        setMode("edit");
        setSelectedNodeId(response.data.nodeId);
        setNodeTitle(response.data.title);
        setNodeSummary(response.data.summary ?? "");
        setNodeContent(response.data.content);
        setNotice("Đã thêm node mới.");
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSavingNode(false);
    }
  }

  async function handleDeleteNode() {
    if (!selectedNode) return;
    if (!window.confirm(`Xóa node "${selectedNode.title}"? Thao tác này không thể hoàn tác.`)) return;
    setIsSavingNode(true);
    setError(undefined);
    try {
      await apiClient.deleteDocumentNode(slug, selectedNode.nodeId);
      setSelectedNodeId(undefined);
      setMode("edit");
      setNodeTitle("");
      setNodeSummary("");
      setNodeContent("");
      await loadAll();
      setNotice("Đã xóa node.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSavingNode(false);
    }
  }

  async function handleSaveMeta(event: FormEvent) {
    event.preventDefault();
    setIsSavingMeta(true);
    setError(undefined);
    try {
      const response = await apiClient.updateDocument(slug, {
        title: metaTitle,
        tags: metaTags.split(",").map((tag) => tag.trim()).filter(Boolean),
        version: metaVersion
      });
      setDoc(response.data);
      setNotice("Đã lưu thông tin tài liệu.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSavingMeta(false);
    }
  }

  async function handleRegenerateSummary() {
    setIsRegenerating(true);
    setError(undefined);
    try {
      const response = await apiClient.regenerateDocSummary(slug);
      setDoc(response.data);
      setNotice("Đã tạo lại doc summary.");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsRegenerating(false);
    }
  }

  function toggleExpanded(nodeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function renderTree(parentId: string, depth: number): ReactNode {
    const children = childrenMap.get(parentId) ?? [];
    return children.map((node) => {
      const hasChildren = (childrenMap.get(node.nodeId) ?? []).length > 0;
      const isOpen = expanded.has(node.nodeId);
      const isSelected = mode === "edit" && node.nodeId === selectedNodeId;
      return (
        <div key={node.nodeId}>
          <div
            className={`flex items-center gap-1 rounded-md px-1 py-1 text-sm ${
              isSelected ? "bg-mint/15 text-stone-900" : "text-stone-700 hover:bg-stone-100"
            }`}
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
          >
            {hasChildren ? (
              <button type="button" onClick={() => toggleExpanded(node.nodeId)} className="shrink-0 rounded p-0.5 text-stone-400 hover:text-stone-700" aria-label={isOpen ? "Collapse" : "Expand"}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <span className="w-[19px] shrink-0" />
            )}
            <button type="button" onClick={() => handleSelect(node)} className="min-w-0 flex-1 truncate text-left" title={node.title}>
              {node.title}
            </button>
            <button type="button" onClick={() => handleStartAdd(node.nodeId)} className="shrink-0 rounded p-0.5 text-stone-300 hover:text-mint" title="Thêm node con" aria-label="Add child node">
              <Plus size={14} />
            </button>
          </div>
          {hasChildren && isOpen ? renderTree(node.nodeId, depth + 1) : null}
        </div>
      );
    });
  }

  const addParentNode = addParentId ? byId.get(addParentId) : undefined;

  return (
    <AdminLayout>
      <section className="p-5 md:p-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link href="/admin/documents" className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900">
            <ArrowLeft size={16} aria-hidden="true" />
            Documents
          </Link>
          <h1 className="text-xl font-semibold text-stone-900">{doc?.title ?? slug}</h1>
          <span className="text-xs text-stone-500">{slug}</span>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={`/api/documents/${encodeURIComponent(slug)}/export`}
              className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-xs hover:bg-stone-50"
            >
              <Download size={15} aria-hidden="true" />
              Export JSON
            </a>
            <button
              type="button"
              onClick={handleRegenerateSummary}
              disabled={isRegenerating}
              className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 shadow-xs hover:bg-stone-50 disabled:opacity-50"
            >
              <RefreshCw size={15} aria-hidden="true" className={isRegenerating ? "animate-spin" : undefined} />
              Regenerate summary
            </button>
          </div>
        </div>

        {error ? <div className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div> : null}

        <form onSubmit={handleSaveMeta} className="mb-4 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-xs md:grid-cols-[1fr_1fr_120px_auto]">
          <label className="block">
            <span className="text-xs font-medium text-stone-500">Title</span>
            <input value={metaTitle} onChange={(event) => setMetaTitle(event.target.value)} required className="mt-1 h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-500">Tags</span>
            <input value={metaTags} onChange={(event) => setMetaTags(event.target.value)} placeholder="helpdesk,warranty" className="mt-1 h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-stone-500">Version</span>
            <input value={metaVersion} onChange={(event) => setMetaVersion(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
          </label>
          <button type="submit" disabled={isSavingMeta} className="self-end inline-flex h-9 items-center gap-2 rounded-md bg-mint px-3 text-sm font-medium text-white shadow-xs hover:bg-mint/90 disabled:opacity-50">
            <Save size={15} aria-hidden="true" />
            Save
          </button>
          {doc?.docSummary ? (
            <details className="md:col-span-4 text-sm text-stone-600">
              <summary className="cursor-pointer text-xs font-medium text-stone-500">Doc summary (dùng cho doc routing)</summary>
              <p className="mt-1 whitespace-pre-wrap">{doc.docSummary}</p>
            </details>
          ) : null}
        </form>

        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <div className="rounded-xl border border-stone-200 bg-white shadow-xs">
            <div className="flex items-center gap-2 border-b border-stone-200 p-3">
              <Search size={15} className="shrink-0 text-stone-400" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Tìm node theo tiêu đề..."
                className="h-8 w-full rounded-md border border-stone-200 px-2 text-sm outline-none focus:border-mint"
              />
              <button type="button" onClick={() => handleStartAdd(undefined)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-300 px-2 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50" title="Thêm node gốc">
                <Plus size={13} aria-hidden="true" />
                Root
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-2">
              {isLoading ? (
                <p className="p-2 text-sm text-stone-500">Loading nodes...</p>
              ) : searchMatches ? (
                searchMatches.length === 0 ? (
                  <p className="p-2 text-sm text-stone-500">Không tìm thấy node nào.</p>
                ) : (
                  searchMatches.map((node) => (
                    <button
                      key={node.nodeId}
                      type="button"
                      onClick={() => handleSelect(node)}
                      className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                        mode === "edit" && node.nodeId === selectedNodeId ? "bg-mint/15 text-stone-900" : "text-stone-700 hover:bg-stone-100"
                      }`}
                      title={node.path.join(" > ")}
                    >
                      {node.title}
                      <span className="block truncate text-xs text-stone-400">{node.path.slice(0, -1).join(" > ") || "root"}</span>
                    </button>
                  ))
                )
              ) : nodes.length === 0 ? (
                <p className="p-2 text-sm text-stone-500">Tài liệu chưa có node nào.</p>
              ) : (
                renderTree("", 0)
              )}
            </div>
            <p className="border-t border-stone-200 p-3 text-xs text-stone-500">{nodes.length} nodes</p>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-xs">
            {mode === "edit" && !selectedNode ? (
              <p className="text-sm text-stone-500">Chọn một node bên trái để xem/sửa, hoặc nhấn nút + để thêm node mới.</p>
            ) : (
              <form onSubmit={handleSubmitNode} className="grid gap-3">
                {mode === "add" ? (
                  <p className="rounded-md bg-stone-50 p-2 text-xs text-stone-600">
                    Thêm node mới {addParentNode ? <>dưới <span className="font-medium">{addParentNode.path.join(" > ")}</span></> : "ở cấp gốc"}. nodeId sẽ được tự sinh từ tiêu đề.
                  </p>
                ) : selectedNode ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-stone-50 p-2 text-xs text-stone-500">
                    <span>nodeId: <span className="font-mono text-stone-700">{selectedNode.nodeId}</span></span>
                    <span>path: {selectedNode.path.join(" > ")}</span>
                    <span>level: {selectedNode.level}</span>
                    {selectedNode.pageStart !== undefined ? <span>pages: {selectedNode.pageStart}-{selectedNode.pageEnd ?? selectedNode.pageStart}</span> : null}
                    <span>Tạo lúc: {new Date(selectedNode.createdAt).toLocaleString()}</span>
                    <span>Sửa lần cuối: {new Date(selectedNode.updatedAt).toLocaleString()}</span>
                  </div>
                ) : null}

                <label className="block">
                  <span className="text-sm font-medium text-stone-700">Title</span>
                  <input value={nodeTitle} onChange={(event) => setNodeTitle(event.target.value)} required className="mt-1 h-9 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-mint" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-stone-700">Summary <span className="font-normal text-stone-400">(tùy chọn, hỗ trợ retrieval)</span></span>
                  <textarea value={nodeSummary} onChange={(event) => setNodeSummary(event.target.value)} rows={2} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-mint" />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-stone-700">Content</span>
                  <textarea
                    value={nodeContent}
                    onChange={(event) => setNodeContent(event.target.value)}
                    rows={16}
                    required={mode === "add"}
                    placeholder={CONTENT_PLACEHOLDER}
                    className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm outline-none focus:border-mint"
                  />
                </label>
                <p className="text-xs text-stone-500">
                  Content là Markdown (đoạn văn, bảng dạng <span className="font-mono">| ... |</span>). Bảng lớn hơn ~15 dòng nên tách thành node con riêng để retrieval chính xác hơn.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" disabled={isSavingNode || !isDirty} className="inline-flex items-center gap-2 rounded-md bg-coral px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-coral/90 disabled:opacity-50">
                    <Save size={15} aria-hidden="true" />
                    {mode === "add" ? "Thêm node" : "Lưu thay đổi"}
                  </button>
                  {mode === "edit" && selectedNode ? (
                    <button
                      type="button"
                      onClick={handleDeleteNode}
                      disabled={isSavingNode || selectedNode.childrenIds.length > 0}
                      title={selectedNode.childrenIds.length > 0 ? "Chỉ xóa được node lá (không có node con)" : "Xóa node này"}
                      className="inline-flex items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      Xóa node
                    </button>
                  ) : null}
                  {isDirty ? <span className="text-xs text-amber-600">Chưa lưu</span> : null}
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </AdminLayout>
  );
}
