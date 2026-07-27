import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import {
  buildCompactOutline,
  buildPageIndexForest,
  expandSelectedTreeNodes,
  makeNodeKey
} from "./pageindex-tree";
import type { DocumentRecord, PageIndexNodeRecord } from "./repository";

test("builds a forest and expands a content-bearing child for a heading", () => {
  const document = makeDocument();
  const root = makeNode(document, { nodeId: "root", title: "Root", content: "" });
  const child = makeNode(document, {
    nodeId: "child",
    parentNodeId: "root",
    title: "Child",
    content: "Evidence"
  });
  const forest = buildPageIndexForest([document], [root, child]);

  assert.equal(forest.roots.length, 1);
  assert.equal(forest.roots[0].children[0].node.nodeId, "child");
  const expanded = expandSelectedTreeNodes(
    forest,
    [{ key: makeNodeKey(document.slug, "root"), relevance: 0.9 }],
    6
  );
  assert.deepEqual(expanded.map((item) => item.treeNode.node.nodeId), ["child"]);
});

test("treats an orphan as a root and rejects duplicate node keys", () => {
  const document = makeDocument();
  const orphan = makeNode(document, { nodeId: "orphan", parentNodeId: "missing" });
  const forest = buildPageIndexForest([document], [orphan]);
  assert.equal(forest.roots[0].node.nodeId, "orphan");

  assert.throws(
    () => buildPageIndexForest([document], [orphan, { ...orphan, _id: new ObjectId() }]),
    /Duplicate PageIndex node key/
  );
});

test("detects cycles even when no cyclic node is reachable from a root", () => {
  const document = makeDocument();
  const first = makeNode(document, { nodeId: "first", parentNodeId: "second" });
  const second = makeNode(document, { nodeId: "second", parentNodeId: "first" });
  assert.throws(() => buildPageIndexForest([document], [first, second]), /Cycle detected/);
});

test("honors the compact outline budget", () => {
  const document = makeDocument();
  const nodes = Array.from({ length: 20 }, (_, index) =>
    makeNode(document, {
      nodeId: `node-${index}`,
      title: `A long title for node ${index}`,
      summary: "A summary that deliberately consumes outline budget."
    })
  );
  const forest = buildPageIndexForest([document], nodes);
  const result = buildCompactOutline(forest, 400);
  assert.equal(result.truncated, true);
  assert.ok(result.outline.length <= 400);
  assert.ok(result.nodeCount < nodes.length);
});

test("uses compact references without losing the exact scoped node key", () => {
  const document = makeDocument();
  const node = makeNode(document, {
    nodeId: "a-very-long-node-id-that-should-not-be-sent-as-the-reference",
    title: "Short title"
  });
  const forest = buildPageIndexForest([document], [node]);
  const result = buildCompactOutline(forest, 4_000, { compactRefs: true });

  assert.match(result.outline, /^\[n000\]/);
  assert.equal(result.outline.includes(node.nodeId), false);
  assert.equal(result.refToKey.get("n000"), makeNodeKey(document.slug, node.nodeId));
});

function makeDocument(): DocumentRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    _id: new ObjectId(),
    title: "Manual",
    slug: "manual",
    status: "ready",
    tags: ["test"],
    createdAt: now,
    updatedAt: now
  };
}

function makeNode(
  document: DocumentRecord,
  input: {
    nodeId: string;
    parentNodeId?: string;
    title?: string;
    summary?: string;
    content?: string;
  }
): PageIndexNodeRecord {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    _id: new ObjectId(),
    documentId: document._id,
    nodeId: input.nodeId,
    parentNodeId: input.parentNodeId,
    title: input.title ?? input.nodeId,
    summary: input.summary,
    content: input.content ?? "Content",
    path: [input.title ?? input.nodeId],
    level: input.parentNodeId ? 2 : 1,
    childrenIds: [],
    createdAt: now,
    updatedAt: now
  };
}
