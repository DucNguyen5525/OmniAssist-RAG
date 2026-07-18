import type { PageIndexNodeRecord } from "./repository";

interface ExportNode {
  nodeId: string;
  title: string;
  level: number;
  summary?: string;
  content: string;
  pageStart?: number;
  pageEnd?: number;
  sourceRef?: string;
  children: ExportNode[];
}

// Rebuilds the nested PageIndex JSON tree from flattened Mongo records.
// The output round-trips through flattenPageIndexTree, so manual dashboard edits
// can be exported and re-imported without loss.
export function buildPageIndexTree(title: string, records: PageIndexNodeRecord[]): { title: string; nodes: ExportNode[] } {
  const byId = new Map<string, ExportNode>();
  for (const record of records) {
    byId.set(record.nodeId, {
      nodeId: record.nodeId,
      title: record.title,
      level: record.level,
      summary: record.summary,
      content: record.content,
      pageStart: record.pageStart,
      pageEnd: record.pageEnd,
      sourceRef: record.sourceRef,
      children: []
    });
  }

  const roots: ExportNode[] = [];
  for (const record of records) {
    const node = byId.get(record.nodeId);
    if (!node) continue;
    const parent = record.parentNodeId ? byId.get(record.parentNodeId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return { title, nodes: roots };
}
