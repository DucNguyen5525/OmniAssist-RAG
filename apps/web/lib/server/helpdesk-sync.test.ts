import assert from "node:assert/strict";
import test from "node:test";
import type {
  Helpdesk,
  HelpdeskDocument,
  PageIndexNode
} from "@helpdesk/shared";
import {
  buildHelpdeskSyncSnapshot,
  HelpdeskSyncError
} from "./helpdesk-sync";

const helpdesk: Helpdesk = {
  id: "helpdesk-1",
  name: "Tech Support",
  slug: "tech-support",
  tags: ["tech-support"],
  topK: 6,
  retrievalMode: "pageindex",
  documentSlugs: ["manual-b", "manual-a"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z"
};

const documents: HelpdeskDocument[] = [
  {
    id: "doc-b",
    title: "Manual B",
    slug: "manual-b",
    status: "ready",
    contentHash: "hash-b",
    tags: ["tech-support"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z"
  },
  {
    id: "doc-a",
    title: "Manual A",
    slug: "manual-a",
    status: "ready",
    contentHash: "hash-a",
    tags: ["tech-support"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-28T08:00:00.000Z"
  },
  {
    id: "doc-unrelated",
    title: "Unrelated Manual",
    slug: "unrelated-manual",
    status: "ready",
    contentHash: "hash-unrelated",
    tags: ["other-helpdesk"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-28T07:00:00.000Z"
  }
];

const nodes: PageIndexNode[] = [
  {
    id: "mongo-node-b",
    documentId: "doc-b",
    nodeId: "refund",
    title: "Refund",
    content: "Refund steps",
    path: ["Payments", "Refund"],
    level: 1,
    childrenIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z"
  },
  {
    id: "mongo-node-a",
    documentId: "doc-a",
    nodeId: "batch",
    title: "Batch",
    content: "Batch steps",
    path: ["Batch"],
    level: 0,
    childrenIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-28T08:00:00.000Z"
  },
  {
    id: "mongo-node-unrelated",
    documentId: "doc-unrelated",
    nodeId: "private",
    title: "Unrelated",
    content: "Must not be synchronized",
    path: ["Other"],
    level: 0,
    childrenIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-28T07:00:00.000Z"
  }
];

test("exports only ready documents explicitly linked to the helpdesk", async () => {
  let requestedSlugs: string[] = [];
  let requestedDocumentIds: string[] = [];
  const snapshot = await buildHelpdeskSyncSnapshot("tech-support", {
    getHelpdesk: async () => helpdesk,
    listLinkedReadyDocuments: async (slugs) => {
      requestedSlugs = slugs;
      return documents;
    },
    listDocumentNodes: async (documentIds) => {
      requestedDocumentIds = documentIds;
      return nodes;
    },
    now: () => new Date("2026-07-28T12:00:00.000Z")
  });

  assert.deepEqual(requestedSlugs, ["manual-a", "manual-b"]);
  assert.deepEqual(requestedDocumentIds, ["doc-a", "doc-b"]);
  assert.deepEqual(snapshot.documents.map((item) => item.slug), [
    "manual-a",
    "manual-b"
  ]);
  assert.deepEqual(snapshot.nodes.map((item) => item.nodeId), [
    "batch",
    "refund"
  ]);
  assert.equal(snapshot.helpdeskSlug, "tech-support");
  assert.equal(snapshot.schemaVersion, 1);
  assert.match(snapshot.snapshotVersion, /^[a-f0-9]{64}$/);
});

test("an empty document selection produces an empty safe snapshot", async () => {
  const snapshot = await buildHelpdeskSyncSnapshot("tech-support", {
    getHelpdesk: async () => ({ ...helpdesk, documentSlugs: [] }),
    listLinkedReadyDocuments: async () => {
      throw new Error("must not list all MongoDB documents");
    },
    listDocumentNodes: async () => {
      throw new Error("must not list all MongoDB nodes");
    },
    now: () => new Date("2026-07-28T12:00:00.000Z")
  });

  assert.deepEqual(snapshot.documents, []);
  assert.deepEqual(snapshot.nodes, []);
  assert.deepEqual(snapshot.requestedDocumentSlugs, []);
});

test("rejects missing and non-PageIndex helpdesks", async () => {
  const dependencies = {
    getHelpdesk: async () => null,
    listLinkedReadyDocuments: async () => [],
    listDocumentNodes: async () => [],
    now: () => new Date()
  };

  await assert.rejects(
    () => buildHelpdeskSyncSnapshot("missing", dependencies),
    (error: unknown) =>
      error instanceof HelpdeskSyncError && error.statusCode === 404
  );

  await assert.rejects(
    () =>
      buildHelpdeskSyncSnapshot("tech-support", {
        ...dependencies,
        getHelpdesk: async () => ({ ...helpdesk, retrievalMode: "amg" })
      }),
    (error: unknown) =>
      error instanceof HelpdeskSyncError && error.statusCode === 409
  );
});
