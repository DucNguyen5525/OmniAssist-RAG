import dns from "node:dns";
import { Db, MongoClient } from "mongodb";
import { getServerEnv } from "./env";

try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Fallback if environment restricts setting DNS servers
}

declare global {
  var helpdeskMongoClientPromise: Promise<MongoClient> | undefined;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!globalThis.helpdeskMongoClientPromise) {
    const env = getServerEnv();
    const client = new MongoClient(env.mongodbUri, {
      maxPoolSize: 10
    });
    globalThis.helpdeskMongoClientPromise = client.connect();
  }

  return globalThis.helpdeskMongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const env = getServerEnv();
  const client = await getMongoClient();
  return client.db(env.mongodbDb);
}

export async function ensureMongoIndexes() {
  const db = await getDb();
  await Promise.all([
    db.collection("documents").createIndex({ slug: 1 }, { unique: true }),
    db.collection("documents").createIndex({ status: 1, tags: 1 }),
    db.collection("pageindex_nodes").createIndex({ documentId: 1, nodeId: 1 }, { unique: true }),
    db.collection("pageindex_nodes").createIndex({ documentId: 1, level: 1 }),
    db.collection("conversations").createIndex({ updatedAt: -1 }),
    db.collection("messages").createIndex({ conversationId: 1, createdAt: 1 }),
    db.collection("feedback").createIndex({ messageId: 1 }),
    db.collection("datasets").createIndex({ datasetSlug: 1 }, { unique: true }),
    db.collection("dataset_rows").createIndex({ datasetId: 1 })
  ]);
}
