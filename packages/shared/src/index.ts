export type DocumentStatus = "ready" | "processing" | "failed";
export type MessageRole = "user" | "assistant" | "system";
export type RetrievalMode = "pageindex" | "amg";

export interface HelpdeskDocument {
  id: string;
  title: string;
  slug: string;
  sourceFileUrl?: string;
  indexFileUrl?: string;
  status: DocumentStatus;
  version?: string;
  tags: string[];
  docSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageFeedback = "up" | "down";

export interface PageIndexNode {
  id: string;
  documentId: string;
  nodeId: string;
  parentNodeId?: string;
  title: string;
  summary?: string;
  content: string;
  path: string[];
  level: number;
  pageStart?: number;
  pageEnd?: number;
  sourceRef?: string;
  childrenIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SourceReference {
  documentId: string;
  documentTitle: string;
  nodeId: string;
  nodeTitle: string;
  path: string[];
  pageStart?: number;
  pageEnd?: number;
  sourceRef?: string;
  preview?: string;
  score?: number;
  images?: string[];
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  sources: SourceReference[];
  feedback?: MessageFeedback | null;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatResponse {
  conversationId: string;
  answer: string;
  sources: SourceReference[];
  messageId?: string;
}

/** NDJSON events emitted by POST /api/chat when `stream: true`. */
export type ChatStreamEvent =
  | { type: "meta"; conversationId: string; sources: SourceReference[] }
  | { type: "delta"; text: string }
  | { type: "done"; messageId?: string }
  | { type: "error"; message: string };

export interface ModelsInfo {
  models: string[];
  defaultModel: string;
}

export interface ImportSuggestion {
  action: "new" | "update";
  matchedSlug?: string;
  title: string;
  slug: string;
  tags: string[];
  reason: string;
}

export interface RetrievalResponseItem extends SourceReference {
  content: string;
  summary?: string;
}

export interface Helpdesk {
  id: string;
  name: string;
  slug: string;
  description?: string;
  tags: string[];
  topK: number;
  systemPrompt?: string;
  model?: string;
  retrievalMode: RetrievalMode;
  datasetSlug?: string;
  documentSlugs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DatasetColumn {
  name: string;
  label: string;
  type: "number" | "category";
  unit?: string;
  categories?: string[];
}

export interface DatasetInfo {
  id: string;
  slug: string;
  title: string;
  source: string;
  rowCount: number;
  columns: DatasetColumn[];
}

export interface PredictionModelInfo {
  slug: string;
  title: string;
  target: string;
  positiveClass: string;
  datasetSlug: string;
  inputFeatures: Array<{ name: string; label: string; type: "number" | "category"; categories?: string[] }>;
  metrics: { auroc: number; n: number; positives: number; threshold: number };
}

export interface PredictionContribution {
  feature: string;
  impact: number;
}

export interface PredictionResult {
  probability: number;
  riskLabel: "thấp" | "trung bình" | "cao";
  aboveThreshold: boolean;
  threshold: number;
  contributions: PredictionContribution[];
  modelSlug: string;
  disclaimer: string;
}
