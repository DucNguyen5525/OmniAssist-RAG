import type { DocumentRecord, PageIndexNodeRecord } from "./repository";

export interface PageIndexTreeNode {
  key: string;
  document: DocumentRecord;
  node: PageIndexNodeRecord;
  children: PageIndexTreeNode[];
}

export interface PageIndexForest {
  roots: PageIndexTreeNode[];
  byKey: Map<string, PageIndexTreeNode>;
  keysByNodeId: Map<string, string[]>;
}

export function makeNodeKey(documentSlug: string, nodeId: string) {
  return `${documentSlug}::${nodeId}`;
}

export function buildPageIndexForest(
  documents: DocumentRecord[],
  nodes: PageIndexNodeRecord[]
): PageIndexForest {
  const documentById = new Map(documents.map((document) => [document._id.toString(), document]));
  const byKey = new Map<string, PageIndexTreeNode>();
  const keysByNodeId = new Map<string, string[]>();

  for (const node of nodes) {
    const document = documentById.get(node.documentId.toString());
    if (!document) continue;
    const key = makeNodeKey(document.slug, node.nodeId);
    if (byKey.has(key)) throw new Error(`Duplicate PageIndex node key '${key}'.`);
    byKey.set(key, { key, document, node, children: [] });
    keysByNodeId.set(node.nodeId, [...(keysByNodeId.get(node.nodeId) ?? []), key]);
  }

  const roots: PageIndexTreeNode[] = [];
  for (const treeNode of byKey.values()) {
    const parentKey = treeNode.node.parentNodeId
      ? makeNodeKey(treeNode.document.slug, treeNode.node.parentNodeId)
      : undefined;
    const parent = parentKey ? byKey.get(parentKey) : undefined;
    if (parent && parent.key !== treeNode.key) parent.children.push(treeNode);
    else roots.push(treeNode);
  }

  assertAcyclic(roots, byKey);
  sortTree(roots);
  return { roots, byKey, keysByNodeId };
}

export function buildCompactOutline(
  forest: PageIndexForest,
  maxChars: number,
  options: { compactRefs?: boolean } = {}
) {
  const lines: string[] = [];
  const refToKey = new Map<string, string>();
  let used = 0;
  let truncated = false;

  const visit = (node: PageIndexTreeNode, depth: number) => {
    const summary = compactText(node.node.summary ?? "", 180);
    const pageRange = formatPageRange(node.node.pageStart, node.node.pageEnd);
    const suffix = [pageRange, summary].filter(Boolean).join(" | ");
    const ref = options.compactRefs ? `n${lines.length.toString(36).padStart(3, "0")}` : node.key;
    const line = `${"  ".repeat(Math.min(depth, 8))}[${ref}] ${compactText(node.node.title, 180)}${suffix ? ` | ${suffix}` : ""}`;
    if (used + line.length + 1 > maxChars) {
      truncated = true;
      return false;
    }
    lines.push(line);
    refToKey.set(ref, node.key);
    used += line.length + 1;
    for (const child of node.children) {
      if (!visit(child, depth + 1)) return false;
    }
    return true;
  };

  for (const root of forest.roots) {
    if (!visit(root, 0)) break;
  }

  return { outline: lines.join("\n"), truncated, nodeCount: lines.length, refToKey };
}

export function expandSelectedTreeNodes(
  forest: PageIndexForest,
  selectedKeys: Array<{ key: string; relevance: number }>,
  topK: number
) {
  const output: Array<{ treeNode: PageIndexTreeNode; relevance: number }> = [];
  const seen = new Set<string>();

  const add = (treeNode: PageIndexTreeNode, relevance: number) => {
    if (seen.has(treeNode.key) || !treeNode.node.content.trim() || output.length >= topK) return;
    seen.add(treeNode.key);
    output.push({ treeNode, relevance });
  };

  const addDescendants = (treeNode: PageIndexTreeNode, relevance: number) => {
    for (const child of treeNode.children) {
      if (output.length >= topK) return;
      add(child, relevance);
      if (!child.node.content.trim()) addDescendants(child, relevance);
    }
  };

  for (const selected of selectedKeys) {
    if (output.length >= topK) break;
    const treeNode = forest.byKey.get(selected.key);
    if (!treeNode) continue;
    add(treeNode, selected.relevance);
    if (!treeNode.node.content.trim()) addDescendants(treeNode, selected.relevance);
  }

  return output;
}

function assertAcyclic(roots: PageIndexTreeNode[], byKey: Map<string, PageIndexTreeNode>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: PageIndexTreeNode) => {
    if (visiting.has(node.key)) throw new Error(`Cycle detected at PageIndex node '${node.key}'.`);
    if (visited.has(node.key)) return;
    visiting.add(node.key);
    for (const child of node.children) visit(child);
    visiting.delete(node.key);
    visited.add(node.key);
  };

  for (const root of roots) visit(root);
  for (const node of byKey.values()) visit(node);
}

function sortTree(nodes: PageIndexTreeNode[]) {
  nodes.sort((left, right) => {
    const levelDiff = left.node.level - right.node.level;
    return levelDiff || left.node.nodeId.localeCompare(right.node.nodeId);
  });
  for (const node of nodes) sortTree(node.children);
}

function compactText(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function formatPageRange(start?: number, end?: number) {
  if (!start) return "";
  return `pages ${start}${end && end !== start ? `-${end}` : ""}`;
}
