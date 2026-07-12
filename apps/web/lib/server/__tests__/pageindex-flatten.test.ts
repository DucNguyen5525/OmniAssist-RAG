import { describe, expect, it } from "vitest";
import { flattenPageIndexTree } from "../pageindex-flatten";

describe("flattenPageIndexTree", () => {
  it("flattens a nodes-array tree with parent ids, paths and levels", () => {
    const indexJson = {
      title: "Manual",
      nodes: [
        {
          nodeId: "root",
          title: "Root section",
          content: "root content",
          children: [
            { nodeId: "child-a", title: "Child A", content: "child a content" },
            { nodeId: "child-b", title: "Child B", content: "child b content" }
          ]
        }
      ]
    };

    const nodes = flattenPageIndexTree({ indexJson });

    expect(nodes.map((n) => n.nodeId)).toEqual(["root", "child-a", "child-b"]);
    const childA = nodes.find((n) => n.nodeId === "child-a");
    expect(childA?.parentNodeId).toBe("root");
    expect(childA?.path).toEqual(["Root section", "Child A"]);
    expect(childA?.level).toBe(1);
    expect(nodes[0].childrenIds).toEqual(["child-a", "child-b"]);
  });

  it("deduplicates repeated nodeIds and keeps the first occurrence", () => {
    const indexJson = {
      nodes: [
        { nodeId: "dup", title: "First", content: "first" },
        { nodeId: "dup", title: "Second", content: "second" }
      ]
    };

    const nodes = flattenPageIndexTree({ indexJson });

    expect(nodes).toHaveLength(1);
    expect(nodes[0].title).toBe("First");
  });

  it("generates slug-style ids when nodeId is missing", () => {
    const indexJson = { nodes: [{ title: "Set up Tip Đặc biệt", content: "x" }] };

    const nodes = flattenPageIndexTree({ indexJson });

    expect(nodes[0].nodeId).toMatch(/^[a-z0-9-]+$/);
    expect(nodes[0].nodeId).toContain("set-up-tip");
  });

  it("keeps heading-only nodes and applies the untitled fallback", () => {
    const indexJson = {
      nodes: [
        { nodeId: "untitled", title: "", content: "some content" },
        { nodeId: "heading-only", title: "Heading only", content: "" }
      ]
    };

    const nodes = flattenPageIndexTree({ indexJson });

    expect(nodes.map((n) => n.nodeId)).toEqual(["untitled", "heading-only"]);
    expect(nodes[0].title).toBe("Untitled section");
  });
});
