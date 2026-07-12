import { describe, expect, it } from "vitest";
import { extractImageUrls, scoreCandidates, type ScoreCandidate } from "../retrieval";

function candidate(overrides: Partial<ScoreCandidate>): ScoreCandidate {
  return { title: "Generic section", content: "generic content", ...overrides };
}

describe("scoreCandidates", () => {
  it("ranks the node with the rare query term above nodes matching only generic terms", () => {
    const candidates = [
      candidate({ title: "DEJAVOO ISSUES", content: "dejavoo terminal shows double item after reboot" }),
      candidate({ title: "Payment overview", content: "terminal payment terminal payment terminal" }),
      candidate({ title: "General help", content: "help with terminal setup" })
    ];

    const scores = scoreCandidates("dejavoo double item", candidates);

    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });

  it("gives a phrase bonus when the whole query appears in the title", () => {
    const candidates = [
      candidate({ title: "Set up Tip", content: "tip steps" }),
      candidate({ title: "Tips and tricks", content: "set things up, tip" })
    ];

    const scores = scoreCandidates("set up tip", candidates);

    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it("caps repeated content occurrences so keyword stuffing does not dominate", () => {
    const stuffed = candidate({ content: Array(50).fill("refund").join(" ") });
    const titled = candidate({ title: "Refund policy", content: "refund refund" });

    const scores = scoreCandidates("refund", [stuffed, titled]);

    expect(scores[1]).toBeGreaterThan(scores[0]);
  });

  it("returns 0 for nodes with no matching terms", () => {
    const scores = scoreCandidates("warranty", [candidate({ title: "Printer", content: "paper jam" })]);
    expect(scores[0]).toBe(0);
  });
});

describe("extractImageUrls", () => {
  it("extracts local image urls, dedups and caps at 6", () => {
    const many = Array.from({ length: 8 }, (_, i) => `![img](/doc-images/demo/image${i}.webp)`).join("\n");
    const urls = extractImageUrls(`${many}\n![again](/doc-images/demo/image0.webp)`);

    expect(urls).toHaveLength(6);
    expect(urls?.[0]).toBe("/doc-images/demo/image0.webp");
  });

  it("ignores external and non-image references", () => {
    const content = "![ext](https://example.com/a.png) [link](/doc-images/a.webp) plain text";
    expect(extractImageUrls(content)).toBeUndefined();
  });
});
