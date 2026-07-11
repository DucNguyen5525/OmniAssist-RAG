import type { SourceReference } from "@helpdesk/shared";
import { generateChatCompletion } from "./gemini";
import type { DatasetCellValue, DatasetRecord, DatasetRowRecord } from "./repository";

const INSUFFICIENT =
  "Tôi chưa tìm thấy đủ dữ kiện trong bộ dữ liệu hiện có để trả lời câu hỏi này.";

const METRIC_OPS = ["count", "proportion", "mean", "median", "min", "max"] as const;
const FILTER_OPS = ["eq", "ne", "gt", "gte", "lt", "lte"] as const;

type MetricOp = (typeof METRIC_OPS)[number];
type FilterOp = (typeof FILTER_OPS)[number];

interface Filter {
  column: string;
  op: FilterOp;
  value: string | number;
}

interface Metric {
  op: MetricOp;
  column?: string;
  equals?: string | number;
  compare?: FilterOp;
  value?: number;
}

interface QueryPlan {
  intent: "aggregate" | "compare" | "correlation" | "lookup";
  metrics?: Metric[];
  filters?: Filter[];
  groupBy?: string;
  correlation?: { columnX: string; columnY: string };
}

interface MetricResult {
  op: MetricOp;
  column?: string;
  equals?: string | number;
  compare?: FilterOp;
  threshold?: number;
  value: number | null;
  n: number;
  matched?: number;
}

interface ComputedEvidence {
  filters: Filter[];
  filteredRows: number;
  overall?: MetricResult[];
  groups?: Array<{ group: string; n: number; metrics: MetricResult[] }>;
  correlation?: { columnX: string; columnY: string; pearson: number | null; spearman: number | null; n: number };
  confidence: number;
}

export interface TabularAnswer {
  answer: string;
  sources: SourceReference[];
}

export async function generateTabularAnswer(
  question: string,
  dataset: DatasetRecord,
  rows: DatasetRowRecord[],
  systemPrompt?: string,
  model?: string
): Promise<TabularAnswer> {
  if (rows.length === 0) return { answer: INSUFFICIENT, sources: [] };

  const columnNames = new Set(dataset.columns.map((c) => c.name));
  const numericColumns = new Set(dataset.columns.filter((c) => c.type === "number").map((c) => c.name));

  const plan = await planQuery(question, dataset, model);
  if (!plan || !validatePlan(plan, columnNames, numericColumns)) {
    return { answer: INSUFFICIENT, sources: [] };
  }

  const evidence = computeEvidence(plan, rows, numericColumns);
  const answer = await explainEvidence(question, dataset, plan, evidence, systemPrompt, model);
  return { answer, sources: buildSources(dataset, plan, evidence) };
}

async function planQuery(question: string, dataset: DatasetRecord, model?: string): Promise<QueryPlan | null> {
  const codebook = dataset.columns
    .map((c) => {
      const cats = c.categories?.length ? ` (values: ${c.categories.slice(0, 20).join(", ")})` : "";
      return `- ${c.name} [${c.type}]${c.unit ? ` unit=${c.unit}` : ""}${cats}`;
    })
    .join("\n");

  const prompt = `You translate a question about a clinical tabular dataset into a JSON query plan.
Return ONLY a JSON object, no prose.

Dataset: ${dataset.title}
Columns:
${codebook}

Allowed metric ops: ${METRIC_OPS.join(", ")}.
Allowed filter ops: ${FILTER_OPS.join(", ")} (eq/ne for category or number; gt/gte/lt/lte for number).
Use "proportion" with {column, equals} for the fraction of rows where a category column == value.
Use "proportion" with {column, compare, value} for the fraction of rows where a NUMERIC column meets a threshold, e.g. {"op":"proportion","column":"LactateTM","compare":"gt","value":4}.
Use "correlation" with {columnX, columnY} (both numeric) for relationship questions.
Use "groupBy" to break metrics down by a category column.
Only reference columns from the list above. Only use provided category values.

JSON shape:
{
  "intent": "aggregate|compare|correlation|lookup",
  "metrics": [{ "op": "proportion", "column": "shock", "equals": "Yes" }],
  "filters": [{ "column": "age", "op": "gte", "value": 12 }],
  "groupBy": "serotype2",
  "correlation": { "columnX": "colA", "columnY": "colB" }
}
Omit fields that do not apply.

Question: ${question}`;

  let raw: string;
  try {
    raw = await generateChatCompletion([{ role: "user", content: prompt }], { max_tokens: 1024 }, model);
  } catch {
    return null;
  }
  return parsePlan(raw);
}

function parsePlan(raw: string): QueryPlan | null {
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const braces = raw.match(/\{[\s\S]*\}/);
  if (braces) candidates.push(braces[0]);
  candidates.push(raw);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object") return parsed as QueryPlan;
    } catch {
      continue;
    }
  }
  return null;
}

function validatePlan(plan: QueryPlan, columns: Set<string>, numeric: Set<string>): boolean {
  const hasMetrics = Array.isArray(plan.metrics) && plan.metrics.length > 0;
  const hasCorrelation = Boolean(plan.correlation);
  if (!hasMetrics && !hasCorrelation) return false;

  for (const filter of plan.filters ?? []) {
    if (!columns.has(filter.column)) return false;
    if (!FILTER_OPS.includes(filter.op)) return false;
    if (["gt", "gte", "lt", "lte"].includes(filter.op) && typeof filter.value !== "number") return false;
  }

  for (const metric of plan.metrics ?? []) {
    if (!METRIC_OPS.includes(metric.op)) return false;
    if (metric.op !== "count") {
      if (!metric.column || !columns.has(metric.column)) return false;
      if (["mean", "median", "min", "max"].includes(metric.op) && !numeric.has(metric.column)) return false;
      if (metric.op === "proportion") {
        const hasEquals = metric.equals !== undefined;
        const hasCompare = metric.compare !== undefined && typeof metric.value === "number";
        if (!hasEquals && !hasCompare) return false;
        if (hasCompare) {
          if (!FILTER_OPS.includes(metric.compare as FilterOp)) return false;
          if (["gt", "gte", "lt", "lte"].includes(metric.compare as FilterOp) && !numeric.has(metric.column)) return false;
        }
      }
    }
  }

  if (plan.groupBy && !columns.has(plan.groupBy)) return false;
  if (plan.correlation) {
    if (!numeric.has(plan.correlation.columnX) || !numeric.has(plan.correlation.columnY)) return false;
  }
  return true;
}

function computeEvidence(plan: QueryPlan, rows: DatasetRowRecord[], numeric: Set<string>): ComputedEvidence {
  const filters = plan.filters ?? [];
  const filtered = rows.filter((row) => filters.every((f) => matchFilter(row.data[f.column], f)));

  const evidence: ComputedEvidence = {
    filters,
    filteredRows: filtered.length,
    confidence: 0
  };

  const samples: number[] = [];

  if (plan.correlation) {
    const { columnX, columnY } = plan.correlation;
    const pairs: Array<[number, number]> = [];
    for (const row of filtered) {
      const x = row.data[columnX];
      const y = row.data[columnY];
      if (typeof x === "number" && typeof y === "number") pairs.push([x, y]);
    }
    evidence.correlation = {
      columnX,
      columnY,
      pearson: pearson(pairs),
      spearman: spearman(pairs),
      n: pairs.length
    };
    samples.push(pairs.length);
  }

  const metrics = plan.metrics ?? [];
  if (metrics.length > 0) {
    if (plan.groupBy) {
      const groups = new Map<string, DatasetRowRecord[]>();
      for (const row of filtered) {
        const key = row.data[plan.groupBy];
        if (key === null) continue;
        const label = String(key);
        (groups.get(label) ?? groups.set(label, []).get(label)!).push(row);
      }
      evidence.groups = [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([group, groupRows]) => {
          const computed = metrics.map((m) => computeMetric(m, groupRows));
          computed.forEach((r) => samples.push(r.n));
          return { group, n: groupRows.length, metrics: computed };
        });
    } else {
      evidence.overall = metrics.map((m) => {
        const r = computeMetric(m, filtered);
        samples.push(r.n);
        return r;
      });
    }
  }

  evidence.confidence = confidenceFromSamples(samples);
  return evidence;
}

function matchFilter(cell: DatasetCellValue, filter: Filter): boolean {
  return cellMatches(cell, filter.op, filter.value);
}

function cellMatches(cell: DatasetCellValue, op: FilterOp, value: string | number): boolean {
  if (cell === null) return false;
  if (op === "eq") return cell === value || String(cell) === String(value);
  if (op === "ne") return cell !== value && String(cell) !== String(value);
  if (typeof cell !== "number" || typeof value !== "number") return false;
  if (op === "gt") return cell > value;
  if (op === "gte") return cell >= value;
  if (op === "lt") return cell < value;
  if (op === "lte") return cell <= value;
  return false;
}

function computeMetric(metric: Metric, rows: DatasetRowRecord[]): MetricResult {
  const base: MetricResult = { op: metric.op, column: metric.column, equals: metric.equals, value: null, n: 0 };

  if (metric.op === "count") {
    base.value = rows.length;
    base.n = rows.length;
    return base;
  }

  const column = metric.column as string;
  const present = rows.filter((r) => r.data[column] !== null);
  base.n = present.length;
  if (present.length === 0) return base;

  if (metric.op === "proportion") {
    const useCompare = metric.compare !== undefined && typeof metric.value === "number";
    const matched = present.filter((r) =>
      useCompare
        ? cellMatches(r.data[column], metric.compare as FilterOp, metric.value as number)
        : r.data[column] === metric.equals || String(r.data[column]) === String(metric.equals)
    ).length;
    if (useCompare) {
      base.compare = metric.compare;
      base.threshold = metric.value;
    }
    base.matched = matched;
    base.value = matched / present.length;
    return base;
  }

  const nums = present
    .map((r) => r.data[column])
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  base.n = nums.length;
  if (nums.length === 0) return base;

  if (metric.op === "min") base.value = nums[0];
  else if (metric.op === "max") base.value = nums[nums.length - 1];
  else if (metric.op === "mean") base.value = nums.reduce((s, v) => s + v, 0) / nums.length;
  else if (metric.op === "median") base.value = median(nums);
  return base;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pearson(pairs: Array<[number, number]>): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? null : num / denom;
}

function spearman(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 3) return null;
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  return pearson(rx.map((r, i) => [r, ry[i]]));
}

function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function confidenceFromSamples(samples: number[]): number {
  if (samples.length === 0) return 0;
  const minN = Math.min(...samples);
  return Math.max(0, Math.min(1, minN / 50));
}

async function explainEvidence(
  question: string,
  dataset: DatasetRecord,
  plan: QueryPlan,
  evidence: ComputedEvidence,
  systemPrompt?: string,
  model?: string
): Promise<string> {
  const preamble = systemPrompt ? `${systemPrompt}\n\n` : "";
  const evidenceJson = JSON.stringify(evidence, null, 2);

  const prompt = `${preamble}You are a precise data assistant. Answer the user's question using ONLY the computed statistics below.

Rules:
- Every number in your answer must come from the "Computed evidence"; never invent or estimate figures.
- "value" for a proportion is a fraction (0-1); present it as a percentage.
- Report the sample size (n) used and mention any filters applied.
- If the evidence is empty or n is 0, say in Vietnamese: "${INSUFFICIENT}"
- Answer in Vietnamese, clear and direct.

Dataset: ${dataset.title}
Query plan: ${JSON.stringify(plan)}

Computed evidence:
${evidenceJson}

Question:
${question}`;

  try {
    return await generateChatCompletion([{ role: "user", content: prompt }], { max_tokens: 2048 }, model);
  } catch (error) {
    return error instanceof Error ? `Lỗi khi tạo câu trả lời: ${error.message}` : INSUFFICIENT;
  }
}

function buildSources(dataset: DatasetRecord, plan: QueryPlan, evidence: ComputedEvidence): SourceReference[] {
  const parts: string[] = [];
  if (evidence.overall) parts.push(evidence.overall.map(describeMetric).join("; "));
  if (evidence.groups) parts.push(`group by ${plan.groupBy}: ${evidence.groups.length} nhóm`);
  if (evidence.correlation) {
    parts.push(
      `corr(${evidence.correlation.columnX}, ${evidence.correlation.columnY}) pearson=${fmt(evidence.correlation.pearson)}, spearman=${fmt(evidence.correlation.spearman)}, n=${evidence.correlation.n}`
    );
  }
  const filterText = evidence.filters.length
    ? `Lọc: ${evidence.filters.map((f) => `${f.column} ${f.op} ${f.value}`).join(", ")}`
    : "Không lọc";

  return [
    {
      documentId: dataset._id.toString(),
      documentTitle: dataset.title,
      nodeId: dataset.datasetSlug,
      nodeTitle: parts.filter(Boolean).join(" | ") || "Thống kê",
      path: [dataset.source],
      preview: `${filterText}. n=${evidence.filteredRows}.`,
      score: evidence.confidence
    }
  ];
}

function describeMetric(m: MetricResult): string {
  if (m.op === "proportion") {
    const cond = m.compare !== undefined ? `${m.column} ${m.compare} ${m.threshold}` : `${m.column}=${m.equals}`;
    return `proportion(${cond})=${fmt(m.value)} (matched ${m.matched}/${m.n})`;
  }
  if (m.op === "count") return `count=${m.value}`;
  return `${m.op}(${m.column})=${fmt(m.value)} (n=${m.n})`;
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : Number(value.toFixed(4)).toString();
}
