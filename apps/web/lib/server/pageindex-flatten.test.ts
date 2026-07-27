import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { detectPageIndexProducer, flattenPageIndexTree } from "./pageindex-flatten";

const fixturePath = path.resolve("evals/fixtures/pageindex-official-minimal.json");

test("normalizes the official VectifyAI/PageIndex structure and snake_case fields", () => {
  const indexJson = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const nodes = flattenPageIndexTree({ indexJson });

  assert.equal(detectPageIndexProducer(indexJson), "vectify-pageindex");
  assert.equal(nodes.length, 4);

  const operations = nodes.find((node) => node.title === "Operations");
  const start = nodes.find((node) => node.nodeId === "0001");
  const close = nodes.find((node) => node.nodeId === "0002");
  const appendix = nodes.find((node) => node.nodeId === "0003");

  assert.ok(operations);
  assert.deepEqual(operations.childrenIds, ["0001", "0002"]);
  assert.equal(operations.pageStart, 1);
  assert.equal(operations.pageEnd, 3);

  assert.ok(start);
  assert.equal(start.parentNodeId, operations.nodeId);
  assert.equal(start.content, "Open the batch screen and select Start.");
  assert.equal(start.pageStart, 1);
  assert.equal(start.pageEnd, 2);

  assert.ok(close);
  assert.equal(close.summary, "Steps for closing a batch.");
  assert.ok(appendix);
  assert.equal(appendix.pageStart, 42);
  assert.equal(appendix.pageEnd, 42);
});

test("rejects duplicate upstream node IDs instead of silently dropping content", () => {
  assert.throws(
    () =>
      flattenPageIndexTree({
        indexJson: {
          structure: [
            { title: "First", node_id: "0001", text: "first" },
            { title: "Second", node_id: "0001", text: "second" }
          ]
        }
      }),
    /Duplicate PageIndex node ID/
  );
});

test("preserves the existing internal camelCase shape", () => {
  const indexJson = {
    nodes: [
      {
        nodeId: "root",
        title: "Root",
        pageStart: 5,
        children: [{ nodeId: "child", title: "Child", content: "Evidence" }]
      }
    ]
  };
  const nodes = flattenPageIndexTree({ indexJson });

  assert.equal(detectPageIndexProducer(indexJson), "internal-md-converter");
  assert.deepEqual(nodes.map((node) => node.nodeId), ["root", "child"]);
  assert.deepEqual(nodes[0].childrenIds, ["child"]);
  assert.equal(nodes[1].parentNodeId, "root");
});
