import assert from "node:assert/strict";
import test from "node:test";
import { buildPageIndexArtifact, canonicalJsonStringify } from "./pageindex-artifact";

test("builds stable artifact metadata independent of object key order", () => {
  const left = { structure: [{ title: "A", node_id: "0001", text: "Evidence" }], doc_name: "doc" };
  const right = { doc_name: "doc", structure: [{ text: "Evidence", node_id: "0001", title: "A" }] };

  const first = buildPageIndexArtifact(left, { producerVersion: "39121c4" });
  const second = buildPageIndexArtifact(right, { producerVersion: "39121c4" });

  assert.equal(canonicalJsonStringify(left), canonicalJsonStringify(right));
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.producer, "vectify-pageindex");
  assert.equal(first.producerVersion, "39121c4");
  assert.deepEqual(first.rawTree, left);
});

test("allows an explicit producer for internal artifacts", () => {
  const artifact = buildPageIndexArtifact(
    { nodes: [{ nodeId: "root", title: "Root" }] },
    { producer: "internal-md-converter", producerVersion: "md-v1" }
  );

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.producer, "internal-md-converter");
  assert.equal(artifact.producerVersion, "md-v1");
  assert.match(artifact.contentHash, /^[a-f0-9]{64}$/);
});
