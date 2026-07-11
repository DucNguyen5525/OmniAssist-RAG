import fs from "node:fs";
import path from "node:path";
import { generateChatCompletion } from "../apps/web/lib/server/gemini";

interface Args {
  file?: string;
  out?: string;
  "batch-size"?: string;
  model?: string;
  force?: boolean;
}

interface TreeNode {
  nodeId: string;
  title: string;
  level: number;
  content: string;
  summary?: string;
  children: TreeNode[];
}

const MIN_CONTENT_CHARS = 40;
const MAX_CONTENT_CHARS_PER_NODE = 2500;
const MAX_BATCH_CONTENT_CHARS = 12000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error(
      'Usage: npx tsx --env-file=.env scripts/generate-node-summaries.ts --file "....pageindex.json" [--out output.json] [--batch-size 8] [--model gemini-3.5-flash] [--force]'
    );
  }

  const filePath = path.resolve(args.file);
  const outFile = path.resolve(args.out ?? filePath);
  const batchSize = args["batch-size"] ? Number(args["batch-size"]) : 8;
  const model = args.model ?? process.env.PAGEINDEX_MODEL;

  const indexJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as { title: string; nodes: TreeNode[] };

  const pending: TreeNode[] = [];
  let totalNodes = 0;
  let skippedShort = 0;
  let alreadyDone = 0;
  walk(indexJson.nodes, (node) => {
    totalNodes += 1;
    if (node.summary && !args.force) {
      alreadyDone += 1;
      return;
    }
    if ((node.content ?? "").trim().length < MIN_CONTENT_CHARS) {
      skippedShort += 1;
      return;
    }
    pending.push(node);
  });

  console.log(`Nodes: ${totalNodes} total, ${alreadyDone} already summarized, ${skippedShort} skipped (short content), ${pending.length} to summarize.`);

  const batches = buildBatches(pending, batchSize);
  let summarized = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const summaries = (await requestSummaries(batch, model)) ?? (await requestSummaries(batch, model));
    if (!summaries) {
      failed += batch.length;
      console.warn(`Batch ${i + 1}/${batches.length}: failed after retry (${batch.length} nodes skipped).`);
      continue;
    }
    for (const node of batch) {
      const summary = summaries[node.nodeId];
      if (typeof summary === "string" && summary.trim()) {
        node.summary = summary.trim();
        summarized += 1;
      } else {
        failed += 1;
      }
    }
    // persist progress after every batch so an interruption loses at most one batch
    fs.writeFileSync(outFile, JSON.stringify(indexJson, null, 2), "utf8");
    console.log(`Batch ${i + 1}/${batches.length} done (${summarized} summarized, ${failed} failed so far).`);
  }

  console.log(JSON.stringify({ output: outFile, summarized, failed }, null, 2));
}

function walk(nodes: TreeNode[], visit: (node: TreeNode) => void) {
  for (const node of nodes) {
    visit(node);
    walk(node.children ?? [], visit);
  }
}

function buildBatches(nodes: TreeNode[], batchSize: number): TreeNode[][] {
  const batches: TreeNode[][] = [];
  let current: TreeNode[] = [];
  let currentChars = 0;

  for (const node of nodes) {
    const chars = Math.min(node.content.length, MAX_CONTENT_CHARS_PER_NODE);
    if (current.length > 0 && (current.length >= batchSize || currentChars + chars > MAX_BATCH_CONTENT_CHARS)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(node);
    currentChars += chars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

async function requestSummaries(batch: TreeNode[], model?: string): Promise<Record<string, string> | null> {
  const sections = batch
    .map((node) => {
      const content = node.content.slice(0, MAX_CONTENT_CHARS_PER_NODE);
      return `### nodeId: ${node.nodeId}\nTitle: ${node.title}\nContent:\n${content}`;
    })
    .join("\n\n");

  const prompt = `Bạn tóm tắt các mục trong tài liệu hỗ trợ kỹ thuật (Galaxy POS / Dejavoo terminal) để phục vụ tìm kiếm từ khóa.

Yêu cầu cho MỖI mục:
- Viết 1-2 câu tóm tắt bằng tiếng Việt, nêu rõ mục này nói về vấn đề gì và cách xử lý chính.
- GIỮ NGUYÊN các thuật ngữ/tên tiếng Anh quan trọng (tên lỗi, tên chức năng, tên nút, tên hệ thống) bên cạnh diễn giải tiếng Việt, ví dụ: "kết toán lô (batch settlement)", "hoàn tiền (Refund)".
- Không bịa thông tin ngoài nội dung được cho.

Trả về DUY NHẤT một JSON object, key là nodeId, value là câu tóm tắt:
{"<nodeId>": "<tóm tắt>", ...}

Các mục cần tóm tắt:

${sections}`;

  let raw: string;
  try {
    raw = await generateChatCompletion([{ role: "user", content: prompt }], { max_tokens: 4096 }, model);
  } catch (error) {
    console.warn(`LLM call failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }

  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  candidates.push(raw);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    } catch {
      continue;
    }
  }
  console.warn("Could not parse JSON from LLM response.");
  return null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    if (key === "--force") {
      args.force = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) continue;
    i += 1;
    const name = key.slice(2) as Exclude<keyof Args, "force">;
    args[name] = value as never;
  }
  return args;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
