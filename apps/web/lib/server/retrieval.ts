import type { RetrievalResponseItem, SourceReference } from "@helpdesk/shared";
import { getNodesForDocuments, listReadyDocuments, type DocumentRecord, type PageIndexNodeRecord } from "./repository";

export interface RetrievePageIndexInput {
  query: string;
  tags?: string[];
  documentSlugs?: string[];
  topK?: number;
}

export interface RetrievedNode {
  document: DocumentRecord;
  node: PageIndexNodeRecord;
  score: number;
}

export async function retrievePageIndexNodes(input: RetrievePageIndexInput): Promise<RetrievedNode[]> {
  const topK = Math.min(Math.max(input.topK ?? 6, 1), 12);
  const documents = await listReadyDocuments({ tags: input.tags, slugs: input.documentSlugs });
  if (documents.length === 0) return [];

  const nodes = await getNodesForDocuments(documents.map((doc) => doc._id));
  const documentById = new Map(documents.map((doc) => [doc._id.toString(), doc]));

  const scores = scoreCandidates(input.query, nodes);

  const scored = nodes
    .map((node, index) => ({
      node,
      document: documentById.get(node.documentId.toString()),
      score: scores[index]
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
    score: item.score,
    images: extractImageUrls(item.node.content)
  };
}

const MAX_SOURCE_IMAGES = 6;

export function extractImageUrls(content: string): string[] | undefined {
  const urls: string[] = [];
  const pattern = /!\[[^\]]*\]\((\/[^)\s]+\.(?:webp|png|jpe?g|gif))\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null && urls.length < MAX_SOURCE_IMAGES) {
    if (!urls.includes(match[1])) urls.push(match[1]);
  }
  return urls.length > 0 ? urls : undefined;
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

export interface ScoreCandidate {
  title: string;
  path?: string[];
  summary?: string;
  content: string;
  level?: number;
}

// Pure lexical scoring over candidate nodes; exported so tests can run it without MongoDB.
export function scoreCandidates(query: string, candidates: ScoreCandidate[]): number[] {
  const fields = candidates.map((candidate) => ({
    title: normalize(candidate.title),
    path: normalize((candidate.path ?? []).join(" ")),
    summary: normalize(candidate.summary ?? ""),
    content: normalize(candidate.content ?? "")
  }));
  const idf = buildIdf(tokenize(query), fields);
  return candidates.map((candidate, index) => scoreNode(query, fields[index], candidate.level ?? 0, idf));
}

interface NodeFields {
  title: string;
  path: string;
  summary: string;
  content: string;
}

// IDF over the candidate nodes so rare query terms (e.g. "ket toan", "hoan tien")
// outweigh generic ones ("tien", "the") that diacritic-stripped Vietnamese produces everywhere.
function buildIdf(terms: string[], fields: NodeFields[]): Map<string, number> {
  const idf = new Map<string, number>();
  for (const term of terms) {
    let df = 0;
    for (const field of fields) {
      if (field.title.includes(term) || field.path.includes(term) || field.summary.includes(term) || field.content.includes(term)) {
        df += 1;
      }
    }
    idf.set(term, Math.log(1 + fields.length / (1 + df)));
  }
  return idf;
}

function scoreNode(query: string, fields: NodeFields, level: number, idf: Map<string, number>) {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;

  const { title, path, summary, content } = fields;
  let score = 0;
  let matchedIdf = 0;
  let totalIdf = 0;

  for (const term of terms) {
    const weight = idf.get(term) ?? 1;
    totalIdf += weight;
    let termScore = 0;
    if (title.includes(term)) termScore += 8;
    // path already repeats the node title, so keep its weight below title
    if (path.includes(term)) termScore += 4;
    if (summary.includes(term)) termScore += 4;
    const occurrences = countOccurrences(content, term);
    if (occurrences > 0) termScore += Math.min(occurrences, 3) * 2;

    if (termScore > 0) {
      score += termScore * weight;
      matchedIdf += weight;
    }
  }

  // reward nodes covering the informative part of the query, not just its generic terms
  if (totalIdf > 0) score += (matchedIdf / totalIdf) * 15;

  const phrase = normalize(query);
  if (phrase.length > 4) {
    if (title.includes(phrase)) score += 18;
    if (summary.includes(phrase)) score += 10;
    if (content.includes(phrase)) score += 5;
  }

  // small tiebreaker for top-level sections, but never lets a non-matching node pass the score>0 filter
  if (score > 0 && level <= 1) score += 0.5;
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
