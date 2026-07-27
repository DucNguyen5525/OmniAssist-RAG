import { z } from "zod";
import { generateChatCompletion } from "./gemini";
import type { PageIndexForest } from "./pageindex-tree";

const selectionSchema = z.object({
  selected: z
    .array(
      z.object({
        nodeKey: z.string().min(1),
        relevance: z.number().min(0).max(1),
        reason: z.string().max(240)
      })
    )
    .max(12),
  insufficientEvidence: z.boolean().optional()
});

export interface PageIndexSelection {
  selected: Array<{ nodeKey: string; relevance: number; reason: string }>;
  insufficientEvidence: boolean;
}

export async function selectPageIndexNodes(input: {
  query: string;
  outline: string;
  forest: PageIndexForest;
  refToKey?: Map<string, string>;
  topK: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<PageIndexSelection> {
  const nodeReferenceExample = input.refToKey ? "n000" : "document-slug::node-id";
  const prompt = `You are performing PageIndex tree search for a helpdesk corpus.
Given the user query and compact document tree, select only nodes likely to contain enough evidence to answer.

Rules:
- Treat node references inside square brackets as opaque identifiers and copy them exactly.
- First map Vietnamese wording to the likely English helpdesk terminology used in node titles.
- Do not reject a query merely because the query is Vietnamese and the tree titles are English.
- Common domain mappings include: tính lương sai -> payroll issue; báo cáo bán hàng không khớp
  tổng batch -> sales report issue; chốt batch -> settle/auto batch; trả lại tiền -> refund;
  tiền cọc đặt lịch -> deposit for online booking; mất mạng -> internet issue.
- Select at most ${input.topK} nodes.
- Prefer the most specific relevant nodes; select multiple nodes only when the question needs multiple sections.
- For workflow/task questions, prefer the specific node under TICKET WORKFLOW over a general manual section.
- A semantically matching title is enough to select a node for retrieval even when its summary is empty.
- Only when no title or summary semantically matches the topic, return selected=[] and insufficientEvidence=true.
- Do not guess a nearby topic for an out-of-domain query.
- Return strict JSON only. No markdown fences.

Schema:
{"selected":[{"nodeKey":"${nodeReferenceExample}","relevance":0.0,"reason":"short retrieval reason"}],"insufficientEvidence":false}

Query:
${input.query}

Document tree:
${input.outline}`;

  const raw = await generateChatCompletion(
    [{ role: "user", content: prompt }],
    { temperature: 0, response_format: { type: "json_object" } },
    input.model,
    input.signal
  );
  return parsePageIndexSelection(raw, input.forest, input.refToKey);
}

export function parsePageIndexSelection(
  raw: string,
  forest: PageIndexForest,
  refToKey?: Map<string, string>
): PageIndexSelection {
  const parsed = selectionSchema.parse(JSON.parse(extractJsonObject(raw)));
  const unique = new Set<string>();
  const selected = parsed.selected.map((item) => ({
    ...item,
    nodeKey: refToKey?.get(item.nodeKey) ?? item.nodeKey
  }));

  for (const item of selected) {
    if (!forest.byKey.has(item.nodeKey)) {
      throw new Error(`Reasoning selected unknown or out-of-scope node '${item.nodeKey}'.`);
    }
    if (unique.has(item.nodeKey)) throw new Error(`Reasoning selected duplicate node '${item.nodeKey}'.`);
    unique.add(item.nodeKey);
  }

  const insufficientEvidence = parsed.insufficientEvidence ?? selected.length === 0;
  if (insufficientEvidence && selected.length > 0) {
    throw new Error("Reasoning response is contradictory: insufficient evidence with selected nodes.");
  }
  return { selected, insufficientEvidence };
}

export function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error("Reasoning response did not contain a JSON object.");
  return trimmed.slice(first, last + 1);
}
