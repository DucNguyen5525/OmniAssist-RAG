import type { RetrievalResponseItem, SourceReference } from "@helpdesk/shared";
import { getNodesForDocuments, listReadyDocuments, type DocumentRecord, type PageIndexNodeRecord } from "./repository";

export interface RetrievePageIndexInput {
  query: string;
  tags?: string[];
  topK?: number;
}

export interface RetrievedNode {
  document: DocumentRecord;
  node: PageIndexNodeRecord;
  score: number;
}

export async function retrievePageIndexNodes(input: RetrievePageIndexInput): Promise<RetrievedNode[]> {
  const topK = Math.min(Math.max(input.topK ?? 6, 1), 12);
  const documents = await listReadyDocuments({ tags: input.tags });
  if (documents.length === 0) return [];

  const nodes = await getNodesForDocuments(documents.map((doc) => doc._id));
  const documentById = new Map(documents.map((doc) => [doc._id.toString(), doc]));
  const scored = nodes
    .map((node) => ({
      node,
      document: documentById.get(node.documentId.toString()),
      score: scoreNode(input.query, node)
    }))
    .filter((item): item is RetrievedNode => Boolean(item.document) && item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

export function toSourceReference(item: RetrievedNode): SourceReference {
  return {
    documentId: item.document._id.toString(),
    documentTitle: item.document.title,
    nodeId: item.node.nodeId,
    nodeTitle: item.node.title,
    path: item.node.path ?? [],
    pageStart: item.node.pageStart,
    pageEnd: item.node.pageEnd,
    sourceRef: item.node.sourceRef,
    preview: item.node.content.slice(0, 260),
    score: item.score
  };
}

export function toRetrievalResponseItem(item: RetrievedNode): RetrievalResponseItem {
  return {
    ...toSourceReference(item),
    content: item.node.content,
    summary: item.node.summary
  };
}

export function buildContextBlock(items: RetrievedNode[]) {
  return items
    .map((item, index) => {
      const sourceBits = [
        `Document: ${item.document.title}`,
        `Section: ${item.node.title}`,
        item.node.path?.length ? `Path: ${item.node.path.join(" > ")}` : undefined,
        item.node.pageStart ? `Pages: ${item.node.pageStart}${item.node.pageEnd ? `-${item.node.pageEnd}` : ""}` : undefined,
        item.node.sourceRef ? `SourceRef: ${item.node.sourceRef}` : undefined
      ].filter(Boolean);

      return [`[${index + 1}] ${sourceBits.join(" | ")}`, item.node.summary ? `Summary: ${item.node.summary}` : undefined, item.node.content]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function scoreNode(query: string, node: PageIndexNodeRecord) {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;

  const title = normalize(node.title);
  const path = normalize((node.path ?? []).join(" "));
  const summary = normalize(node.summary ?? "");
  const content = normalize(node.content ?? "");
  let score = 0;
  let matchedTerms = 0;

  for (const term of terms) {
    let matched = false;
    if (title.includes(term)) {
      score += 8;
      matched = true;
    }
    // path already repeats the node title, so keep its weight below title
    if (path.includes(term)) {
      score += 4;
      matched = true;
    }
    if (summary.includes(term)) {
      score += 4;
      matched = true;
    }
    const occurrences = countOccurrences(content, term);
    if (occurrences > 0) {
      score += Math.min(occurrences, 3) * 2;
      matched = true;
    }
    if (matched) matchedTerms += 1;
  }

  // reward nodes covering most query terms so content-rich matches beat generic title hits
  score += (matchedTerms / terms.length) * 15;

  const phrase = normalize(query);
  if (phrase.length > 4) {
    if (title.includes(phrase)) score += 18;
    if (summary.includes(phrase)) score += 10;
    if (content.includes(phrase)) score += 5;
  }

  if (node.level <= 1) score += 0.5;
  return score;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function tokenize(value: string) {
  return normalize(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 16);
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
