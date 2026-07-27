import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { extractJsonObject, parsePageIndexSelection } from "./pageindex-reasoning";
import { buildPageIndexForest, makeNodeKey } from "./pageindex-tree";
import type { DocumentRecord, PageIndexNodeRecord } from "./repository";

test("extracts JSON from a fenced or prefixed model response", () => {
  assert.equal(extractJsonObject('result: ```json\n{"selected":[]}\n```'), '{"selected":[]}');
});

test("accepts a scoped selection and infers insufficient evidence for an empty selection", () => {
  const { forest, key } = makeForest();
  const selected = parsePageIndexSelection(
    JSON.stringify({
      selected: [{ nodeKey: key, relevance: 0.9, reason: "Relevant title" }],
      insufficientEvidence: false
    }),
    forest
  );
  assert.equal(selected.selected[0].nodeKey, key);
  assert.equal(selected.insufficientEvidence, false);

  const empty = parsePageIndexSelection('{"selected":[]}', forest);
  assert.equal(empty.insufficientEvidence, true);
});

test("maps a compact model reference back to the exact scoped node key", () => {
  const { forest, key } = makeForest();
  const selected = parsePageIndexSelection(
    '{"selected":[{"nodeKey":"n000","relevance":0.8,"reason":"match"}]}',
    forest,
    new Map([["n000", key]])
  );
  assert.equal(selected.selected[0].nodeKey, key);
});

test("rejects unknown, duplicate, and contradictory selections", () => {
  const { forest, key } = makeForest();
  assert.throws(
    () =>
      parsePageIndexSelection(
        '{"selected":[{"nodeKey":"other::node","relevance":1,"reason":"x"}],"insufficientEvidence":false}',
        forest
      ),
    /unknown or out-of-scope/
  );
  assert.throws(
    () =>
      parsePageIndexSelection(
        JSON.stringify({
          selected: [
            { nodeKey: key, relevance: 1, reason: "x" },
            { nodeKey: key, relevance: 0.8, reason: "y" }
          ],
          insufficientEvidence: false
        }),
        forest
      ),
    /duplicate node/
  );
  assert.throws(
    () =>
      parsePageIndexSelection(
        JSON.stringify({
          selected: [{ nodeKey: key, relevance: 1, reason: "x" }],
          insufficientEvidence: true
        }),
        forest
      ),
    /contradictory/
  );
});

function makeForest() {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const document: DocumentRecord = {
    _id: new ObjectId(),
    title: "Manual",
    slug: "manual",
    status: "ready",
    tags: [],
    createdAt: now,
    updatedAt: now
  };
  const node: PageIndexNodeRecord = {
    _id: new ObjectId(),
    documentId: document._id,
    nodeId: "node",
    title: "Node",
    content: "Evidence",
    path: ["Node"],
    level: 1,
    childrenIds: [],
    createdAt: now,
    updatedAt: now
  };
  return {
    forest: buildPageIndexForest([document], [node]),
    key: makeNodeKey(document.slug, node.nodeId)
  };
}
