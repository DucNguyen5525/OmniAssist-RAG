import type { CreatePageIndexNodeInput } from "./repository";

interface FlattenInput {
  indexJson: unknown;
}

type FlatNode = CreatePageIndexNodeInput;
export type PageIndexProducer = "vectify-pageindex" | "internal-md-converter" | "unknown";

export function flattenPageIndexTree(input: FlattenInput): FlatNode[] {
  const rootCandidates = getRootCandidates(input.indexJson);
  const nodes: FlatNode[] = [];
  const seen = new Set<string>();

  for (const [siblingIndex, root] of rootCandidates.entries()) {
    walkNode(root, {
      parentNodeId: undefined,
      inheritedPath: [],
      level: 0,
      siblingIndex,
      nodes,
      seen
    });
  }

  return nodes.filter((node) => node.content.trim() || node.summary?.trim() || node.title.trim());
}

export function detectPageIndexProducer(value: unknown): PageIndexProducer {
  if (!value || typeof value !== "object") return "unknown";
  if (containsVectifyShape(value)) return "vectify-pageindex";
  if (containsInternalShape(value)) return "internal-md-converter";
  return "unknown";
}

function getRootCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;

  if (Array.isArray(record.structure)) return record.structure;
  if (Array.isArray(record.nodes)) return record.nodes;
  if (Array.isArray(record.children)) return [record];
  if (record.root) return [record.root];
  if (record.tree) return [record.tree];
  if (record.document) return getRootCandidates(record.document);

  return [record];
}

function walkNode(
  rawNode: unknown,
  state: {
    parentNodeId?: string;
    inheritedPath: string[];
    level: number;
    siblingIndex: number;
    nodes: FlatNode[];
    seen: Set<string>;
  }
): string | undefined {
  if (!rawNode || typeof rawNode !== "object") return undefined;
  const node = rawNode as Record<string, unknown>;
  const title =
    stringValue(node.title) ||
    stringValue(node.node_title) ||
    stringValue(node.heading) ||
    stringValue(node.name) ||
    "Untitled section";
  const path = normalizePath(node.path, [...state.inheritedPath, title]);
  const nodeId =
    stringValue(node.nodeId) ||
    stringValue(node.node_id) ||
    stringValue(node.id) ||
    makeNodeId(path, state.siblingIndex);
  const children = arrayValue(node.children) ?? arrayValue(node.nodes) ?? arrayValue(node.sections) ?? [];

  if (state.seen.has(nodeId)) {
    throw new Error(`Duplicate PageIndex node ID '${nodeId}'.`);
  }
  state.seen.add(nodeId);

  const flatNode: FlatNode = {
    nodeId,
    parentNodeId: state.parentNodeId,
    title,
    summary:
      stringValue(node.summary) ||
      stringValue(node.prefix_summary) ||
      stringValue(node.abstract),
    content: stringValue(node.content) || stringValue(node.text) || stringValue(node.body) || "",
    path,
    level: numberValue(node.level) ?? state.level,
    pageStart:
      numberValue(node.pageStart) ??
      numberValue(node.page_start) ??
      numberValue(node.startPage) ??
      numberValue(node.start_index) ??
      numberValue(node.line_num),
    pageEnd:
      numberValue(node.pageEnd) ??
      numberValue(node.page_end) ??
      numberValue(node.endPage) ??
      numberValue(node.end_index) ??
      numberValue(node.line_num),
    sourceRef: stringValue(node.sourceRef) || stringValue(node.source_ref) || stringValue(node.source),
    childrenIds: []
  };
  state.nodes.push(flatNode);

  for (const [siblingIndex, child] of children.entries()) {
    const childNodeId = walkNode(child, {
      parentNodeId: nodeId,
      inheritedPath: path,
      level: state.level + 1,
      siblingIndex,
      nodes: state.nodes,
      seen: state.seen
    });
    if (childNodeId) flatNode.childrenIds.push(childNodeId);
  }

  return nodeId;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function normalizePath(value: unknown, fallback: string[]) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter((childId): childId is string => Boolean(childId));
  if (typeof value === "string" && value.trim()) return value.split(/[>/]/).map((part) => part.trim()).filter((childId): childId is string => Boolean(childId));
  return fallback;
}

function makeNodeId(path: string[], index: number) {
  return `${path.join("-")}-s${index}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || `node-${index}`;
}

function containsVectifyShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsVectifyShape);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    Array.isArray(record.structure) ||
    "node_id" in record ||
    "start_index" in record ||
    "end_index" in record ||
    "line_num" in record ||
    "prefix_summary" in record
  ) {
    return true;
  }
  const children = arrayValue(record.nodes) ?? arrayValue(record.children) ?? arrayValue(record.sections) ?? [];
  return children.some(containsVectifyShape);
}

function containsInternalShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInternalShape);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    "nodeId" in record ||
    Array.isArray(record.children) ||
    "root" in record ||
    "tree" in record ||
    "document" in record
  ) {
    return true;
  }
  return Array.isArray(record.nodes) && record.nodes.some(containsInternalShape);
}
