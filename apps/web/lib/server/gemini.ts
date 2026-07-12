import { getServerEnv } from "./env";
import type { RetrievedNode } from "./retrieval";
import { buildContextBlock } from "./retrieval";

export interface KeyItem {
  key: string;
  weight: number;
  label: string;
}

interface SWRRItem {
  key: string;
  weight: number;
  label: string;
  currentWeight: number;
  effectiveWeight: number;
}

export function parseKeysConfig(input: string): KeyItem[] {
  const items = input.split(",").map((s) => s.trim()).filter(Boolean);
  const result: KeyItem[] = [];

  for (const item of items) {
    if (item.includes(":")) {
      const lastColon = item.lastIndexOf(":");
      const keyPart = item.slice(0, lastColon).trim();
      const weightPart = item.slice(lastColon + 1).trim();
      const weightVal = Number.parseInt(weightPart, 10);
      const weight = Number.isNaN(weightVal) || weightVal <= 0 ? 1 : weightVal;
      result.push({
        key: keyPart,
        weight,
        label: `${keyPart.length > 8 ? `${keyPart.slice(0, 8)}...` : keyPart} (Weight: ${weight})`,
      });
    } else {
      result.push({
        key: item,
        weight: 1,
        label: `${item.length > 8 ? `${item.slice(0, 8)}...` : item} (Weight: 1)`,
      });
    }
  }

  if (result.length === 0) {
    throw new Error("No valid keys configured for GCLI key rotation.");
  }

  return result;
}

export class SmoothWeightedRoundRobin {
  private items: SWRRItem[] = [];

  constructor(items: KeyItem[]) {
    this.items = items.map((item) => ({
      key: item.key,
      weight: item.weight,
      label: item.label,
      currentWeight: 0,
      effectiveWeight: item.weight,
    }));
  }

  public getNext(): KeyItem {
    if (this.items.length === 0) {
      throw new Error("Không có key nào trong danh sách xoay vòng.");
    }

    let totalWeight = 0;
    let best: SWRRItem | null = null;

    for (const item of this.items) {
      item.currentWeight += item.effectiveWeight;
      totalWeight += item.effectiveWeight;

      if (best === null || item.currentWeight > best.currentWeight) {
        best = item;
      }
    }

    if (best === null) {
      throw new Error("Không chọn được key phù hợp.");
    }

    best.currentWeight -= totalWeight;

    return {
      key: best.key,
      weight: best.weight,
      label: best.label,
    };
  }
}

export class WeightedRandom {
  private items: KeyItem[];

  constructor(items: KeyItem[]) {
    this.items = items;
  }

  public getNext(): KeyItem {
    if (this.items.length === 0) {
      throw new Error("Không có key nào trong danh sách xoay vòng.");
    }

    const totalWeight = this.items.reduce((sum, item) => sum + item.weight, 0);
    let randomVal = Math.random() * totalWeight;

    for (const item of this.items) {
      if (randomVal < item.weight) {
        return item;
      }
      randomVal -= item.weight;
    }

    return this.items[this.items.length - 1];
  }
}

export class GCLIKeyRotator {
  public keysConfig: KeyItem[];
  private strategy: string;
  private swrrRotator?: SmoothWeightedRoundRobin;
  private wrRotator?: WeightedRandom;

  constructor(keysConfig: KeyItem[], strategy = "swrr") {
    this.keysConfig = keysConfig;
    this.strategy = strategy.toLowerCase();

    if (this.strategy === "swrr") {
      this.swrrRotator = new SmoothWeightedRoundRobin(keysConfig);
    } else if (this.strategy === "random") {
      this.wrRotator = new WeightedRandom(keysConfig);
    } else {
      throw new Error(`Chiến lược xoay vòng không hợp lệ: ${strategy}`);
    }
  }

  public getNextKey(): KeyItem {
    if (this.strategy === "swrr" && this.swrrRotator) {
      return this.swrrRotator.getNext();
    }
    if (this.strategy === "random" && this.wrRotator) {
      return this.wrRotator.getNext();
    }
    throw new Error("No rotator initialized.");
  }
}

export const GCLI_MODEL_CODE_MAP: Record<string, string> = {
  "gemini-2.5-flash": "假流式-agy-gemini-2.5-flash-low",
  "gemini-3-flash": "假流式-agy-gemini-3-flash-low",
  "gemini-3.5-flash": "假流式-agy-gemini-3.5-flash-low",
  "gemini-3.1-pro": "假流式-agy-gemini-3.1-pro-low",
};

export function resolveGcliModelCode(model: string, disableFallback = false): string {
  if (!disableFallback) {
    if (model === "gemini-3-flash-preview") {
      if (Math.random() < 0.2) {
        return "假流式-agy-gemini-3-flash-low";
      }
    } else if (model === "gemini-3.1-pro-preview") {
      if (Math.random() < 0.2) {
        return "假流式-agy-gemini-3.1-pro-low";
      }
    }
  }
  return GCLI_MODEL_CODE_MAP[model] ?? model;
}

export class ResilientGCLIClient {
  public rotator: GCLIKeyRotator;
  private baseUrl: string;

  constructor(keysConfig: KeyItem[], baseUrl: string, strategy = "swrr") {
    this.rotator = new GCLIKeyRotator(keysConfig, strategy);
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  public async createChatCompletion(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown> = {}
  ): Promise<{ content: string; usedLabel: string; triedLabels: string[] }> {
    const maxRetries = this.rotator.keysConfig.length;
    let attempts = 0;
    const triedLabels: string[] = [];
    let lastError: Error | null = null;

    while (attempts < maxRetries) {
      const keyInfo = this.rotator.getNextKey();
      attempts++;
      triedLabels.push(keyInfo.label);

      const resolvedModel = resolveGcliModelCode(model);
      const modelTag = resolvedModel !== model ? `${model} -> ${resolvedModel}` : model;
      const endpoint = `${this.baseUrl}/chat/completions`;

      console.log(
        `🔄 [Attempt ${attempts}/${maxRetries}] Using Key: '${keyInfo.label}' (Weight=${keyInfo.weight}) for model '${modelTag}'...`
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keyInfo.key}`,
          },
          body: JSON.stringify({
            model: resolvedModel,
            messages,
            ...options,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content: string = data.choices?.[0]?.message?.content ?? "";
        console.log(`✅ Success using Key: '${keyInfo.label}'`);
        return { content, usedLabel: keyInfo.label, triedLabels };
      } catch (error) {
        const errObj = error instanceof Error ? error : new Error(String(error));
        console.warn(`⚠️ Error using key '${keyInfo.label}': ${errObj.message}`);
        lastError = errObj;
        if (attempts >= maxRetries) {
          console.error(`❌ All ${maxRetries} keys in pool failed!`);
          throw lastError;
        }
        console.log("↪️ Automatically switching to next key in rotation pool...");
      }
    }

    throw lastError ?? new Error("All key attempts failed.");
  }

  // Streaming variant: rotates keys until a connection succeeds, then yields content deltas.
  public async createChatCompletionStream(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown> = {}
  ): Promise<AsyncGenerator<string, void, unknown>> {
    const maxRetries = this.rotator.keysConfig.length;
    let attempts = 0;
    let lastError: Error | null = null;

    while (attempts < maxRetries) {
      const keyInfo = this.rotator.getNextKey();
      attempts++;

      const resolvedModel = resolveGcliModelCode(model);
      const endpoint = `${this.baseUrl}/chat/completions`;
      console.log(`🔄 [Stream attempt ${attempts}/${maxRetries}] Using Key: '${keyInfo.label}' for model '${resolvedModel}'...`);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${keyInfo.key}`,
          },
          body: JSON.stringify({
            model: resolvedModel,
            messages,
            stream: true,
            ...options,
          }),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        console.log(`✅ Stream connected using Key: '${keyInfo.label}'`);
        return parseSseContentDeltas(response.body);
      } catch (error) {
        const errObj = error instanceof Error ? error : new Error(String(error));
        console.warn(`⚠️ Stream error using key '${keyInfo.label}': ${errObj.message}`);
        lastError = errObj;
      }
    }

    throw lastError ?? new Error("All key attempts failed.");
  }
}

let clientInstance: ResilientGCLIClient | null = null;
let cachedConfigStr = "";

function getResilientClient(): { client: ResilientGCLIClient; model: string } {
  const env = getServerEnv();
  const configKey = `${env.gcliBaseUrl}|${env.gcliApiKeys}|${env.gcliStrategy}`;

  if (!clientInstance || cachedConfigStr !== configKey) {
    const keysConfig = parseKeysConfig(env.gcliApiKeys);
    clientInstance = new ResilientGCLIClient(keysConfig, env.gcliBaseUrl, env.gcliStrategy);
    cachedConfigStr = configKey;
  }

  return { client: clientInstance, model: env.gcliModel };
}

export function getAvailableModels(): { models: string[]; defaultModel: string } {
  const env = getServerEnv();
  return { models: env.gcliModels, defaultModel: env.gcliModel };
}

// Requested models outside GCLI_MODELS silently fall back to the env default.
export function resolveRequestedModel(requested?: string): string {
  const env = getServerEnv();
  if (requested && env.gcliModels.includes(requested)) return requested;
  return env.gcliModel;
}

export async function generateChatCompletion(
  messages: Array<{ role: string; content: string }>,
  options: Record<string, unknown> = {},
  model?: string
): Promise<string> {
  const { client } = getResilientClient();
  const result = await client.createChatCompletion(resolveRequestedModel(model), messages, options);
  return result.content.trim();
}

export async function generateGroundedAnswer(
  question: string,
  retrievedNodes: RetrievedNode[],
  systemPrompt?: string,
  model?: string
) {
  if (retrievedNodes.length === 0) {
    return NO_CONTEXT_ANSWER;
  }

  const { client } = getResilientClient();
  const resolvedModel = resolveRequestedModel(model);
  const prompt = buildGroundedPrompt(question, retrievedNodes, systemPrompt);

  const result = await client.createChatCompletion(resolvedModel, [
    { role: "user", content: prompt },
  ]);

  return result.content.trim();
}

// Streaming variant used by /api/chat when the client asks for `stream: true`.
export async function* generateGroundedAnswerStream(
  question: string,
  retrievedNodes: RetrievedNode[],
  systemPrompt?: string,
  model?: string
): AsyncGenerator<string, void, unknown> {
  if (retrievedNodes.length === 0) {
    yield NO_CONTEXT_ANSWER;
    return;
  }

  const { client } = getResilientClient();
  const resolvedModel = resolveRequestedModel(model);
  const prompt = buildGroundedPrompt(question, retrievedNodes, systemPrompt);

  const deltas = await client.createChatCompletionStream(resolvedModel, [
    { role: "user", content: prompt },
  ]);
  yield* deltas;
}

const NO_CONTEXT_ANSWER = "Tôi chưa tìm thấy đủ thông tin trong tài liệu hiện có để trả lời câu hỏi này.";

function buildGroundedPrompt(question: string, retrievedNodes: RetrievedNode[], systemPrompt?: string) {
  const context = buildContextBlock(retrievedNodes);
  const systemPreamble = systemPrompt ? `${systemPrompt}\n\n` : "";

  return `${systemPreamble}You are a precise helpdesk assistant. Answer the user's question using only the PageIndex context below.

Rules:
- Do not use outside knowledge.
- Do not invent policies, prices, names, instructions, dates, or technical details.
- If the context is insufficient, say in Vietnamese: "${NO_CONTEXT_ANSWER}"
- Answer in Vietnamese by default.
- Keep the answer clear, direct, and helpful.
- Include source references using document title and section/path when possible.
- If the context contains markdown image references (like ![...](/doc-images/...)) that directly illustrate a step or issue in your answer, include those exact markdown image tags inline at the relevant step. Copy image URLs exactly as-is; never invent or modify image URLs.

Response format:
Answer:
[answer]

Sources:
- [document title / section path / page range if available]

PageIndex context:
${context}

Question:
${question}`;
}

// Parses an OpenAI-compatible SSE body into content delta strings.
async function* parseSseContentDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
          if (delta) yield delta;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}


