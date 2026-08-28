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

  const fields = nodes.map((node) => ({
    title: padded(node.title),
    path: padded((node.path ?? []).join(" ")),
    summary: padded(node.summary ?? ""),
    content: padded(node.content ?? "")
  }));
  // Tokenized once here rather than per node: scoreNode used to redo this work
  // for every candidate, and the bigrams below would have been rebuilt too.
  const terms = tokenize(input.query, { dropStopwords: true });
  const idf = buildIdf(terms, fields);
  const bigrams = buildBigrams(terms);

  const scored = nodes
    .map((node, index) => ({
      node,
      document: documentById.get(node.documentId.toString()),
      score: scoreNode(input.query, terms, bigrams, fields[index], node.level, idf)
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
    preview: (item.node.content || item.node.summary || "").slice(0, 260),
    score: item.score,
    images: extractImageUrls(item.node.content)
  };
}

const MAX_SOURCE_IMAGES = 6;

function extractImageUrls(content: string): string[] | undefined {
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

interface NodeFields {
  title: string;
  path: string;
  summary: string;
  content: string;
}

// A term that only *starts* a token still says something \u2014 "pay" for "payment" \u2014
// so it keeps a fraction of the weight. A term buried inside a token says nothing:
// with diacritics stripped, Vietnamese syllables are two or three characters, so a
// raw substring test had "an" matching inside "thanh", "toan" and "hoan" on nearly
// every node, and the field weights fired on all of them.
//
// Prefixes must keep scoring rather than merely rank lower: retrievePageIndexNodes
// drops any node scoring zero, so a lost prefix match disappears instead of slipping.
const PREFIX_MATCH_WEIGHT = 0.5;

// Adjacent-pair bonuses, each half the single-token weight of the same field.
// Vietnamese writes a compound as separate syllables, so token scoring alone cannot
// tell a node that says "hoa don" from one that merely contains "hoa chat" and
// "don hang" somewhere. Scoring the pairs recovers most of what a word segmenter
// would give, with no model and no second index. Half weight because both syllables
// have already scored on their own.
const BIGRAM_TITLE_BONUS = 4;
const BIGRAM_PATH_BONUS = 2;
const BIGRAM_SUMMARY_BONUS = 2;
const BIGRAM_CONTENT_BONUS = 1;

// Question scaffolding, already normalized. Kept deliberately short: after diacritics
// are stripped a Vietnamese "stopword" is very often a domain term too, and dropping
// one silently costs recall no test would catch. Excluded for that reason \u2014 "the"
// (th\u1ebb, card), "qua" (qu\u00e0, gift), "dang" (\u0111\u0103ng nh\u1eadp, login), "long" (l\u00f4ng), "chi"
// (chi ti\u00eau), "moi" (m\u1edbi), "dau" (d\u1ea7u), "toi" (t\u1ed1i), "ban" (b\u00e1n), "cung" (cung c\u1ea5p),
// "cho" (ch\u1edd). English "the" is excluded for the same collision with "th\u1ebb".
const QUERY_STOPWORDS = new Set([
  "va", "voi", "cua", "thi", "duoc", "nay", "lam", "sao", "nao", "tai",
  "gi", "vui", "giup", "minh", "hoac", "neu", "nhung", "rat", "deu",
  "nua", "se", "khi", "xin",
  "how", "what", "where", "and", "for"
]);

// The functions below are the algorithm surface that
// docs/shared_retrieval_spec/SHARED_RETRIEVAL_ARCHITECTURE.md §2 specifies and that
// support_kb mirrors in Dart. They are exported so the parity tests can pin them
// directly; retrievePageIndexNodes remains the only entry point application code uses.

// IDF over the candidate nodes so rare query terms (e.g. "ket toan", "hoan tien")
// outweigh generic ones ("tien", "the") that diacritic-stripped Vietnamese produces everywhere.
export function buildIdf(terms: string[], fields: NodeFields[]): Map<string, number> {
  const idf = new Map<string, number>();
  for (const term of terms) {
    let df = 0;
    for (const field of fields) {
      if (
        matchStrength(field.title, term) > 0 ||
        matchStrength(field.path, term) > 0 ||
        matchStrength(field.summary, term) > 0 ||
        matchStrength(field.content, term) > 0
      ) {
        df += 1;
      }
    }
    idf.set(term, Math.log(1 + fields.length / (1 + df)));
  }
  return idf;
}

export function scoreNode(
  query: string,
  terms: string[],
  bigrams: string[],
  fields: NodeFields,
  level: number,
  idf: Map<string, number>
) {
  if (terms.length === 0) return 0;

  const { title, path, summary, content } = fields;
  let score = 0;
  let matchedIdf = 0;
  let totalIdf = 0;

  for (const term of terms) {
    const weight = idf.get(term) ?? 1;
    totalIdf += weight;
    let termScore = 0;
    termScore += 8 * matchStrength(title, term);
    // path already repeats the node title, so keep its weight below title
    termScore += 4 * matchStrength(path, term);
    termScore += 4 * matchStrength(summary, term);
    const contentStrength = matchStrength(content, term);
    if (contentStrength > 0) {
      termScore += Math.min(countTokenMatches(content, term), 3) * 2 * contentStrength;
    }

    if (termScore > 0) {
      score += termScore * weight;
      matchedIdf += weight;
    }
  }

  for (const bigram of bigrams) {
    if (title.includes(bigram)) score += BIGRAM_TITLE_BONUS;
    if (path.includes(bigram)) score += BIGRAM_PATH_BONUS;
    if (summary.includes(bigram)) score += BIGRAM_SUMMARY_BONUS;
    if (content.includes(bigram)) score += BIGRAM_CONTENT_BONUS;
  }

  // reward nodes covering the informative part of the query, not just its generic terms
  if (totalIdf > 0) score += (matchedIdf / totalIdf) * 15;

  const phrase = normalize(query);
  if (phrase.length > 4) {
    if (title.includes(phrase)) score += 18;
    if (summary.includes(phrase)) score += 10;
    if (content.includes(phrase)) score += 5;
  }

  if (level <= 1) score += 0.5;
  return score;
}

// Each consecutive pair of query terms, shaped for a padded field: the first syllable
// must be a whole token, the second may be a prefix. Deduped, because the caller may
// pass a query whose terms repeat.
export function buildBigrams(terms: string[]): string[] {
  const pairs = new Set<string>();
  for (let index = 0; index < terms.length - 1; index += 1) {
    pairs.add(` ${terms[index]} ${terms[index + 1]}`);
  }
  return [...pairs];
}

// Normalization leaves single spaces between tokens, so a field padded on both ends
// makes " term " a whole-token test and " term" a token-prefix one \u2014 with every token,
// including the first and last, reachable.
export function padded(value: string) {
  return ` ${normalize(value)} `;
}

function matchStrength(paddedField: string, term: string) {
  if (paddedField.includes(` ${term} `)) return 1;
  if (paddedField.includes(` ${term}`)) return PREFIX_MATCH_WEIGHT;
  return 0;
}

// How many tokens in the padded field start with the term.
function countTokenMatches(paddedField: string, term: string) {
  if (!term) return 0;
  const needle = ` ${term}`;
  let count = 0;
  let index = paddedField.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = paddedField.indexOf(needle, index + needle.length);
  }
  return count;
}

// dropStopwords is for the *query* only. Node text is never filtered: a word missing
// from the index is unfindable, while a word missing from the question merely stops
// dragging in every node that happens to contain it.
export function tokenize(value: string, options?: { dropStopwords?: boolean }) {
  const words = normalize(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  if (!options?.dropStopwords) return words.slice(0, 16);

  const kept = words.filter((term) => !QUERY_STOPWORDS.has(term)).slice(0, 16);
  // A question made of nothing but scaffolding still has to run.
  return kept.length > 0 ? kept : words.slice(0, 16);
}

export function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // \u0111 (U+0111) has no canonical decomposition, so NFD leaves it whole and the
    // punctuation strip below would turn it into a space \u2014 truncating every word
    // starting with it ("\u0111\u01a1n", "\u0111\u0103ng nh\u1eadp", "\u0111\u1eb7t l\u1ecbch") at both index and query time.
    .replace(/\u0111/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
