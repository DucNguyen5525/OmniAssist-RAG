import type { ImportSuggestion } from "@helpdesk/shared";
import { generateChatCompletion } from "./gemini";
import { flattenPageIndexTree } from "./pageindex-flatten";
import { listDocuments } from "./repository";

const MAX_SECTION_TITLES = 40;

export async function analyzeImportCandidate(indexJson: unknown): Promise<ImportSuggestion> {
  const nodes = flattenPageIndexTree({ indexJson });
  if (nodes.length === 0) throw new Error("No PageIndex nodes were found in the provided JSON.");

  const candidateTitle =
    (typeof indexJson === "object" && indexJson !== null && typeof (indexJson as { title?: unknown }).title === "string"
      ? ((indexJson as { title: string }).title as string)
      : "") || nodes[0].title;
  const sectionTitles = nodes.slice(0, MAX_SECTION_TITLES).map((node) => node.title);

  const existing = await listDocuments();
  const existingList =
    existing.length > 0
      ? existing.map((doc) => `- slug: ${doc.slug} | title: ${doc.title} | tags: ${doc.tags.join(", ") || "(none)"}`).join("\n")
      : "(chưa có tài liệu nào)";

  const prompt = `Bạn giúp quản trị viên quyết định cách nhập một tài liệu PageIndex mới vào hệ thống helpdesk.

Các tài liệu đã có trong hệ thống:
${existingList}

Tài liệu mới:
Title: ${candidateTitle}
Các mục trong tài liệu:
${sectionTitles.map((title) => `- ${title}`).join("\n")}

Nhiệm vụ:
1. Nếu tài liệu mới rõ ràng là phiên bản cập nhật của một tài liệu đã có (cùng chủ đề, cùng loại nội dung), chọn action "update" và trả về slug của tài liệu đó trong matchedSlug.
2. Nếu là chủ đề mới, chọn action "new" và đề xuất slug kebab-case tiếng Anh ngắn gọn.
3. Đề xuất title rõ ràng và 1-3 tags (ưu tiên dùng lại tags đã có nếu phù hợp; thêm tag mới khi là mảng nội dung mới, ví dụ marketing, pos-guide).
4. Giải thích ngắn gọn lý do bằng tiếng Việt trong reason.

Trả về DUY NHẤT một JSON object:
{"action": "new" | "update", "matchedSlug": "...", "title": "...", "slug": "...", "tags": ["..."], "reason": "..."}`;

  const raw = await generateChatCompletion([{ role: "user", content: prompt }], { max_tokens: 1024 });
  const parsed = parseSuggestion(raw);
  if (!parsed) throw new Error("AI không trả về đề xuất hợp lệ. Vui lòng điền thông tin thủ công.");

  return normalizeSuggestion(parsed, candidateTitle, new Set(existing.map((doc) => doc.slug)));
}

function parseSuggestion(raw: string): Partial<ImportSuggestion> | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  candidates.push(raw);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object") return parsed as Partial<ImportSuggestion>;
    } catch {
      continue;
    }
  }
  return null;
}

// exported for unit tests
export function normalizeSuggestion(
  parsed: Partial<ImportSuggestion>,
  candidateTitle: string,
  existingSlugs: Set<string>
): ImportSuggestion {
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : candidateTitle;
  const matchedSlug =
    parsed.action === "update" && typeof parsed.matchedSlug === "string" && existingSlugs.has(parsed.matchedSlug)
      ? parsed.matchedSlug
      : undefined;
  const action = matchedSlug ? "update" : "new";
  const slug = matchedSlug ?? slugify(typeof parsed.slug === "string" && parsed.slug.trim() ? parsed.slug : title);
  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())).slice(0, 5) : [];

  return {
    action,
    matchedSlug,
    title,
    slug,
    tags,
    reason: typeof parsed.reason === "string" ? parsed.reason : ""
  };
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "document"
  );
}
