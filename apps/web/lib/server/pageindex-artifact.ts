import { createHash } from "node:crypto";
import { detectPageIndexProducer, type PageIndexProducer } from "./pageindex-flatten";

export const PAGEINDEX_TREE_SCHEMA_VERSION = 1;
export const MAX_INLINE_PAGEINDEX_TREE_BYTES = 14_000_000;

export interface PageIndexArtifactMetadata {
  schemaVersion: number;
  producer: PageIndexProducer;
  producerVersion?: string;
  contentHash: string;
  byteSize: number;
  rawTree?: unknown;
}

export function buildPageIndexArtifact(
  indexJson: unknown,
  input?: {
    producer?: PageIndexProducer;
    producerVersion?: string;
    externalArtifactAvailable?: boolean;
  }
): PageIndexArtifactMetadata {
  const canonicalJson = canonicalJsonStringify(indexJson);
  const byteSize = Buffer.byteLength(canonicalJson, "utf8");
  if (byteSize > MAX_INLINE_PAGEINDEX_TREE_BYTES && !input?.externalArtifactAvailable) {
    throw new Error(
      `PageIndex JSON is ${byteSize} bytes and cannot be stored safely in one MongoDB document. ` +
      "Provide indexFileUrl or enable backupToR2."
    );
  }

  return {
    schemaVersion: PAGEINDEX_TREE_SCHEMA_VERSION,
    producer: input?.producer ?? detectPageIndexProducer(indexJson),
    producerVersion: input?.producerVersion?.trim() || undefined,
    contentHash: createHash("sha256").update(canonicalJson).digest("hex"),
    byteSize,
    rawTree: byteSize <= MAX_INLINE_PAGEINDEX_TREE_BYTES ? indexJson : undefined
  };
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJsonValue(child)])
  );
}
