import { generateChatCompletion } from "./gemini";

const MAX_HISTORY_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 500;
const MAX_REWRITTEN_CHARS = 400;

// Follow-up questions ("còn máy P8 thì sao?") lose their subject when retrieval only
// sees the latest message. Condense recent history + new question into a standalone
// question for routing/retrieval/generation; falls back to the original on any failure.
export async function rewriteFollowupQuestion(
  question: string,
  history: { role: string; content: string }[],
  model?: string
): Promise<string> {
  const recent = history.filter((message) => message.content.trim()).slice(-MAX_HISTORY_MESSAGES);
  if (recent.length === 0) return question;

  const transcript = recent
    .map((message) => `${message.role === "user" ? "Người dùng" : "Trợ lý"}: ${truncate(message.content)}`)
    .join("\n");

  const prompt = `Bạn nhận được đoạn hội thoại helpdesk gần nhất và câu hỏi mới của người dùng.
Nếu câu hỏi mới phụ thuộc vào ngữ cảnh hội thoại (đại từ, "còn ... thì sao", thiếu chủ thể/thiết bị), hãy viết lại nó thành một câu hỏi độc lập, đầy đủ chủ thể, giữ nguyên ngôn ngữ và thuật ngữ của người dùng.
Nếu câu hỏi mới đã tự đủ nghĩa, trả về nguyên văn câu hỏi đó.
Chỉ trả về đúng một câu hỏi, không giải thích, không thêm lời dẫn.

Hội thoại gần nhất:
${transcript}

Câu hỏi mới: ${question}`;

  try {
    const rewritten = (await generateChatCompletion([{ role: "user", content: prompt }], {}, model)).trim();
    if (!rewritten || rewritten.length > MAX_REWRITTEN_CHARS) return question;
    return rewritten;
  } catch (error) {
    console.warn("Follow-up rewrite failed, using original question:", error instanceof Error ? error.message : error);
    return question;
  }
}

function truncate(value: string) {
  return value.length > MAX_MESSAGE_CHARS ? `${value.slice(0, MAX_MESSAGE_CHARS)}…` : value;
}
