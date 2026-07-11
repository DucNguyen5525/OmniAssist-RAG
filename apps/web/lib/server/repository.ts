import { ObjectId, type Document as MongoDocument } from "mongodb";
import type { ChatMessage, ChatSession, DatasetColumn, DatasetInfo, Helpdesk, HelpdeskDocument, PageIndexNode, RetrievalMode, SourceReference } from "@helpdesk/shared";
import { ensureMongoIndexes, getDb } from "./mongodb";

export interface DocumentRecord extends MongoDocument {
  _id: ObjectId;
  title: string;
  slug: string;
  sourceFileUrl?: string;
  indexFileUrl?: string;
  status: "ready" | "processing" | "failed";
  version?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PageIndexNodeRecord extends MongoDocument {
  _id: ObjectId;
  documentId: ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePageIndexNodeInput {
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
}

export interface ConversationRecord extends MongoDocument {
  _id: ObjectId;
  userId?: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageRecord extends MongoDocument {
  _id: ObjectId;
  conversationId: ObjectId;
  role: "user" | "assistant" | "system";
  content: string;
  sources: SourceReference[];
  createdAt: Date;
}

export interface HelpdeskRecord extends MongoDocument {
  _id: ObjectId;
  name: string;
  slug: string;
  description?: string;
  tags: string[];
  topK: number;
  systemPrompt?: string;
  model?: string;
  retrievalMode?: RetrievalMode;
  datasetSlug?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatasetRecord extends MongoDocument {
  _id: ObjectId;
  datasetSlug: string;
  title: string;
  source: string;
  rowCount: number;
  columns: DatasetColumn[];
  createdAt: Date;
  updatedAt: Date;
}

export type DatasetCellValue = string | number | null;

export interface DatasetRowRecord extends MongoDocument {
  _id: ObjectId;
  datasetId: ObjectId;
  data: Record<string, DatasetCellValue>;
}

export function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new Error(`Invalid ObjectId: ${id}`);
  return new ObjectId(id);
}

export function serializeDocument(record: DocumentRecord): HelpdeskDocument {
  return {
    id: record._id.toString(),
    title: record.title,
    slug: record.slug,
    sourceFileUrl: record.sourceFileUrl,
    indexFileUrl: record.indexFileUrl,
    status: record.status,
    version: record.version,
    tags: record.tags ?? [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export function serializeNode(record: PageIndexNodeRecord): PageIndexNode {
  return {
    id: record._id.toString(),
    documentId: record.documentId.toString(),
    nodeId: record.nodeId,
    parentNodeId: record.parentNodeId,
    title: record.title,
    summary: record.summary,
    content: record.content,
    path: record.path ?? [],
    level: record.level,
    pageStart: record.pageStart,
    pageEnd: record.pageEnd,
    sourceRef: record.sourceRef,
    childrenIds: record.childrenIds ?? [],
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export function serializeConversation(record: ConversationRecord): ChatSession {
  return {
    id: record._id.toString(),
    userId: record.userId,
    title: record.title,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export function serializeMessage(record: MessageRecord): ChatMessage {
  return {
    id: record._id.toString(),
    conversationId: record.conversationId.toString(),
    role: record.role,
    content: record.content,
    sources: record.sources ?? [],
    createdAt: record.createdAt.toISOString()
  };
}

export function serializeHelpdesk(record: HelpdeskRecord): Helpdesk {
  return {
    id: record._id.toString(),
    name: record.name,
    slug: record.slug,
    description: record.description,
    tags: record.tags ?? [],
    topK: record.topK ?? 6,
    systemPrompt: record.systemPrompt,
    model: record.model,
    retrievalMode: record.retrievalMode ?? "pageindex",
    datasetSlug: record.datasetSlug,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export function serializeDataset(record: DatasetRecord): DatasetInfo {
  return {
    id: record._id.toString(),
    slug: record.datasetSlug,
    title: record.title,
    source: record.source,
    rowCount: record.rowCount ?? 0,
    columns: record.columns ?? []
  };
}

export async function listDocuments(): Promise<HelpdeskDocument[]> {
  await ensureMongoIndexes();
  const db = await getDb();
  const docs = await db.collection<DocumentRecord>("documents").find({}).sort({ updatedAt: -1 }).toArray();
  return docs.map(serializeDocument);
}

export async function listReadyDocuments(filters?: { tags?: string[]; title?: string }) {
  await ensureMongoIndexes();
  const db = await getDb();
  const query: Record<string, unknown> = { status: "ready" };
  if (filters?.tags?.length) query.tags = { $all: filters.tags };
  if (filters?.title) query.title = { $regex: escapeRegex(filters.title), $options: "i" };
  return db.collection<DocumentRecord>("documents").find(query).sort({ updatedAt: -1 }).limit(20).toArray();
}

export async function getNodesForDocuments(documentIds: ObjectId[], limitPerDocument = 150) {
  if (documentIds.length === 0) return [];
  const db = await getDb();
  return db
    .collection<PageIndexNodeRecord>("pageindex_nodes")
    .find({ documentId: { $in: documentIds }, content: { $ne: "" } })
    .sort({ level: 1, nodeId: 1 })
    .limit(documentIds.length * limitPerDocument)
    .toArray();
}

export async function upsertDocumentWithNodes(input: {
  title: string;
  slug: string;
  sourceFileUrl?: string;
  indexFileUrl?: string;
  version?: string;
  tags?: string[];
  nodes: CreatePageIndexNodeInput[];
}) {
  await ensureMongoIndexes();
  const db = await getDb();
  const now = new Date();
  const existing = await db.collection<DocumentRecord>("documents").findOne({ slug: input.slug });
  const documentId = existing?._id ?? new ObjectId();

  await db.collection<DocumentRecord>("documents").updateOne(
    { _id: documentId },
    {
      $set: {
        title: input.title,
        slug: input.slug,
        sourceFileUrl: input.sourceFileUrl,
        indexFileUrl: input.indexFileUrl,
        status: "ready",
        version: input.version,
        tags: input.tags ?? [],
        updatedAt: now
      },
      $setOnInsert: {
        _id: documentId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  await db.collection<PageIndexNodeRecord>("pageindex_nodes").deleteMany({ documentId });
  if (input.nodes.length > 0) {
    const records: PageIndexNodeRecord[] = input.nodes.map((node) => ({
      _id: new ObjectId(),
      documentId,
      nodeId: node.nodeId,
      parentNodeId: node.parentNodeId,
      title: node.title,
      summary: node.summary,
      content: node.content,
      path: node.path,
      level: node.level,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      sourceRef: node.sourceRef,
      childrenIds: node.childrenIds,
      createdAt: now,
      updatedAt: now
    }));
    await db.collection<PageIndexNodeRecord>("pageindex_nodes").insertMany(records);
  }

  const saved = await db.collection<DocumentRecord>("documents").findOne({ _id: documentId });
  if (!saved) throw new Error("Failed to save imported document");
  return serializeDocument(saved);
}

export async function createConversation(title: string, userId?: string) {
  await ensureMongoIndexes();
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<ConversationRecord>("conversations").insertOne({
    _id: new ObjectId(),
    userId,
    title,
    createdAt: now,
    updatedAt: now
  });
  const saved = await db.collection<ConversationRecord>("conversations").findOne({ _id: result.insertedId });
  if (!saved) throw new Error("Failed to create conversation");
  return serializeConversation(saved);
}

export async function listConversations() {
  await ensureMongoIndexes();
  const db = await getDb();
  const records = await db.collection<ConversationRecord>("conversations").find({}).sort({ updatedAt: -1 }).limit(50).toArray();
  return records.map(serializeConversation);
}

export async function listMessages(conversationId: string) {
  const db = await getDb();
  const records = await db
    .collection<MessageRecord>("messages")
    .find({ conversationId: toObjectId(conversationId) })
    .sort({ createdAt: 1 })
    .toArray();
  return records.map(serializeMessage);
}

export async function addMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceReference[];
}) {
  const db = await getDb();
  const now = new Date();
  const conversationObjectId = toObjectId(input.conversationId);
  const result = await db.collection<MessageRecord>("messages").insertOne({
    _id: new ObjectId(),
    conversationId: conversationObjectId,
    role: input.role,
    content: input.content,
    sources: input.sources ?? [],
    createdAt: now
  });
  await db.collection<ConversationRecord>("conversations").updateOne({ _id: conversationObjectId }, { $set: { updatedAt: now } });
  const saved = await db.collection<MessageRecord>("messages").findOne({ _id: result.insertedId });
  if (!saved) throw new Error("Failed to save message");
  return serializeMessage(saved);
}

export async function listHelpdesks(): Promise<Helpdesk[]> {
  await ensureMongoIndexes();
  const db = await getDb();
  const records = await db.collection<HelpdeskRecord>("helpdesks").find({}).sort({ updatedAt: -1 }).toArray();
  return records.map(serializeHelpdesk);
}

export async function getHelpdeskBySlug(slug: string): Promise<Helpdesk | null> {
  const db = await getDb();
  const record = await db.collection<HelpdeskRecord>("helpdesks").findOne({ slug });
  return record ? serializeHelpdesk(record) : null;
}

export async function createHelpdesk(input: { name: string; slug: string; description?: string; tags?: string[]; topK?: number; systemPrompt?: string; model?: string; retrievalMode?: RetrievalMode; datasetSlug?: string }): Promise<Helpdesk> {
  await ensureMongoIndexes();
  const db = await getDb();
  const now = new Date();
  const existing = await db.collection<HelpdeskRecord>("helpdesks").findOne({ slug: input.slug });
  if (existing) throw new Error(`Helpdesk with slug '${input.slug}' already exists`);
  const result = await db.collection<HelpdeskRecord>("helpdesks").insertOne({
    _id: new ObjectId(),
    name: input.name,
    slug: input.slug,
    description: input.description,
    tags: input.tags ?? [],
    topK: input.topK ?? 6,
    systemPrompt: input.systemPrompt,
    model: input.model,
    retrievalMode: input.retrievalMode ?? "pageindex",
    datasetSlug: input.datasetSlug,
    createdAt: now,
    updatedAt: now
  });
  const saved = await db.collection<HelpdeskRecord>("helpdesks").findOne({ _id: result.insertedId });
  if (!saved) throw new Error("Failed to create helpdesk");
  return serializeHelpdesk(saved);
}

export async function updateHelpdesk(slug: string, input: { name?: string; description?: string; tags?: string[]; topK?: number; systemPrompt?: string; model?: string; retrievalMode?: RetrievalMode; datasetSlug?: string }): Promise<Helpdesk | null> {
  const db = await getDb();
  const now = new Date();
  const result = await db.collection<HelpdeskRecord>("helpdesks").findOneAndUpdate(
    { slug },
    { $set: { ...input, updatedAt: now } },
    { returnDocument: "after" }
  );
  return result ? serializeHelpdesk(result as unknown as HelpdeskRecord) : null;
}

export async function deleteHelpdesk(slug: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection<HelpdeskRecord>("helpdesks").deleteOne({ slug });
  return result.deletedCount > 0;
}

export async function listDatasets(): Promise<DatasetInfo[]> {
  await ensureMongoIndexes();
  const db = await getDb();
  const records = await db.collection<DatasetRecord>("datasets").find({}).sort({ updatedAt: -1 }).toArray();
  return records.map(serializeDataset);
}

export async function getDatasetBySlug(datasetSlug: string): Promise<DatasetRecord | null> {
  const db = await getDb();
  return db.collection<DatasetRecord>("datasets").findOne({ datasetSlug });
}

export async function getDatasetRows(datasetId: ObjectId): Promise<DatasetRowRecord[]> {
  const db = await getDb();
  return db.collection<DatasetRowRecord>("dataset_rows").find({ datasetId }).toArray();
}

export async function upsertDatasetWithRows(input: {
  datasetSlug: string;
  title: string;
  source: string;
  columns: DatasetColumn[];
  rows: Array<Record<string, DatasetCellValue>>;
}): Promise<DatasetInfo> {
  await ensureMongoIndexes();
  const db = await getDb();
  const now = new Date();
  const existing = await db.collection<DatasetRecord>("datasets").findOne({ datasetSlug: input.datasetSlug });
  const datasetId = existing?._id ?? new ObjectId();

  await db.collection<DatasetRecord>("datasets").updateOne(
    { _id: datasetId },
    {
      $set: {
        datasetSlug: input.datasetSlug,
        title: input.title,
        source: input.source,
        rowCount: input.rows.length,
        columns: input.columns,
        updatedAt: now
      },
      $setOnInsert: {
        _id: datasetId,
        createdAt: now
      }
    },
    { upsert: true }
  );

  await db.collection<DatasetRowRecord>("dataset_rows").deleteMany({ datasetId });
  if (input.rows.length > 0) {
    const records: DatasetRowRecord[] = input.rows.map((data) => ({
      _id: new ObjectId(),
      datasetId,
      data
    }));
    await db.collection<DatasetRowRecord>("dataset_rows").insertMany(records);
  }

  const saved = await db.collection<DatasetRecord>("datasets").findOne({ _id: datasetId });
  if (!saved) throw new Error("Failed to save dataset");
  return serializeDataset(saved);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
