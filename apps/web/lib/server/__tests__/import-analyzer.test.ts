import { describe, expect, it } from "vitest";
import { normalizeSuggestion } from "../import-analyzer";

const existingSlugs = new Set(["tech-support-manual", "warranty-policy"]);

describe("normalizeSuggestion", () => {
  it("keeps an update action when matchedSlug exists", () => {
    const suggestion = normalizeSuggestion(
      { action: "update", matchedSlug: "tech-support-manual", title: "Tech Support Manual", tags: ["helpdesk"], reason: "same doc" },
      "Fallback title",
      existingSlugs
    );

    expect(suggestion.action).toBe("update");
    expect(suggestion.slug).toBe("tech-support-manual");
    expect(suggestion.tags).toEqual(["helpdesk"]);
  });

  it("downgrades update to new when matchedSlug is not an existing document", () => {
    const suggestion = normalizeSuggestion(
      { action: "update", matchedSlug: "does-not-exist", title: "Marketing Guide" },
      "Fallback title",
      existingSlugs
    );

    expect(suggestion.action).toBe("new");
    expect(suggestion.matchedSlug).toBeUndefined();
    expect(suggestion.slug).toBe("marketing-guide");
  });

  it("falls back to the candidate title and slugifies it", () => {
    const suggestion = normalizeSuggestion({}, "Hướng dẫn bảo hành", existingSlugs);

    expect(suggestion.action).toBe("new");
    expect(suggestion.title).toBe("Hướng dẫn bảo hành");
    expect(suggestion.slug).toBe("huong-dan-bao-hanh");
    expect(suggestion.tags).toEqual([]);
  });

  it("filters non-string tags and limits to 5", () => {
    const suggestion = normalizeSuggestion(
      { title: "Doc", tags: ["a", "", 2 as unknown as string, "b", "c", "d", "e", "f"] },
      "Doc",
      existingSlugs
    );

    expect(suggestion.tags).toEqual(["a", "b", "c", "d", "e"]);
  });
});
