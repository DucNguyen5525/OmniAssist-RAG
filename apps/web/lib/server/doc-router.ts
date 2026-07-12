import { generateChatCompletion } from "./gemini";
import type { CreatePageIndexNodeInput, DocumentRecord } from "./repository";

const MAX_SECTION_TITLES = 40;
const MAX_ROUTED_DOCS = 4;

// Stage 0 (import time): one short Vietnamese summary per document, used later for routing.
export async function generateDocSummary(title: string, nodes: CreatePageIndexNodeInput[], model?: string): Promise<string> {
  const sectionTitles = nodes
    .filter((node) => node.level <= 2)
    .map((node) => node.title)
    .slice(0, MAX_SECTION_TITLES);

  const prompt = `Bạn nhận được tiêu đề và danh sách mục lục của một tài liệu helpdesk.
Viết 2-3 câu tiếng Việt mô tả tài liệu này nói về chủ đề gì và trả lời được những loại câu hỏi nào.
Giữ nguyên thuật ngữ tiếng Anh. Chỉ trả về đoạn mô tả, không thêm lời dẫn.

Tiêu đề: ${title}
Mục lục:
${sectionTitles.map((t) => `- ${t}`).join("\n")}`;

  const summary = await generateChatCompletion([{ role: "user", content: prompt }], {}, model);
  return summary.trim();
}

// Stage 1 (query time): let the LLM pick which documents are worth retrieving from.
// Returns a subset of candidate slugs; falls back to all candidates on any failure.
export async function routeDocuments(question: string, candidates: DocumentRecord[], model?: string): Promise<string[]> {
  const allSlugs = candidates.map((doc) => doc.slug);
  if (candidates.length <= 1) return allSlugs;

  const docList = candidates
    .map((doc) => {
      const bits = [`slug: ${doc.slug}`, `title: ${doc.title}`];
      if (doc.tags?.length) bits.push(`tags: ${doc.tags.join(", ")}`);
      if (doc.docSummary) bits.push(`summary: ${doc.docSummary}`);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");

  const prompt = `Người dùng hỏi một câu trong hệ thống helpdesk có nhiều tài liệu.
Chọn những tài liệu có khả năng chứa câu trả lời (tối đa ${MAX_ROUTED_DOCS}, thường chỉ 1-2).
Chỉ trả về JSON hợp lệ dạng {"slugs": ["..."]} với slug lấy đúng từ danh sách, không giải thích.

Danh sách tài liệu:
${docList}

Câu hỏi: ${question}`;

  try {
    const raw = await generateChatCompletion([{ role: "user", content: prompt }], {}, model);
    const parsed = JSON.parse(extractJson(raw)) as { slugs?: unknown };
    if (!Array.isArray(parsed.slugs)) return allSlugs;
    const routed = parsed.slugs
      .filter((slug): slug is string => typeof slug === "string" && allSlugs.includes(slug))
      .slice(0, MAX_ROUTED_DOCS);
    return routed.length > 0 ? routed : allSlugs;
  } catch (error) {
    console.warn("Doc routing failed, falling back to all candidate documents:", error instanceof Error ? error.message : error);
    return allSlugs;
  }
}

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return raw;
  return raw.slice(start, end + 1);
}
