import assert from "node:assert/strict";
import test from "node:test";
import { buildBigrams, buildIdf, normalize, padded, scoreNode, tokenize } from "./retrieval";

// These pin the algorithm described in docs/shared_retrieval_spec/
// SHARED_RETRIEVAL_ARCHITECTURE.md §2. support_kb asserts the same numbers in
// test/services/retrieval/lexical_ranker_test.dart and text_normalizer_test.dart;
// if you change one side, change both or the parity rule in §1 is broken.

function fieldsFor(node: { title?: string; path?: string; summary?: string; content?: string }) {
  return {
    title: padded(node.title ?? ""),
    path: padded(node.path ?? ""),
    summary: padded(node.summary ?? ""),
    content: padded(node.content ?? "")
  };
}

test("normalize converts đ to d instead of dropping it", () => {
  // NFD leaves U+0111 whole, so the punctuation strip used to turn it into a space
  // and "hóa đơn" tokenized as ["hoa", "on"] — never matching the Dart side.
  assert.equal(normalize("Hóa Đơn"), "hoa don");
  assert.equal(normalize("đăng nhập"), "dang nhap");
  assert.equal(normalize("  Quy trình HOÀN tiền!  "), "quy trinh hoan tien");
});

test("tokenize keeps terms of at least two characters and caps at 16", () => {
  const tokens = tokenize("a 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17");

  assert.equal(tokens.length, 16);
  assert.equal(tokens[0], "01");
  assert.equal(tokens[15], "16");
});

test("node text keeps every word by default", () => {
  assert.deepEqual(tokenize("làm sao in hóa đơn"), ["lam", "sao", "in", "hoa", "don"]);
});

test("a query drops question scaffolding when asked to", () => {
  assert.deepEqual(tokenize("làm sao in hóa đơn", { dropStopwords: true }), ["in", "hoa", "don"]);
});

test("a query of nothing but scaffolding keeps its words", () => {
  assert.ok(tokenize("làm sao vậy", { dropStopwords: true }).length > 0);
});

test("keeps domain words that look like scaffolding", () => {
  const tokens = tokenize("thẻ quà tặng đăng nhập bán chờ", { dropStopwords: true });

  for (const word of ["the", "qua", "dang", "ban", "cho"]) {
    assert.ok(tokens.includes(word), `expected "${word}" to survive stopword filtering`);
  }
});

test("matches the shared weighted IDF, phrase, bigram and level bonuses", () => {
  const fields = [fieldsFor({ title: "Hoàn tiền" }), fieldsFor({ title: "Khác", content: "Hoàn tiền" })];
  const terms = tokenize("hoàn tiền", { dropStopwords: true });
  const idfMap = buildIdf(terms, fields);
  const bigrams = buildBigrams(terms);
  const idf = Math.log(1 + 2 / 3);

  assert.deepEqual(terms, ["hoan", "tien"]);
  assert.deepEqual(bigrams, [" hoan tien"]);
  assert.equal(scoreNode("hoàn tiền", terms, bigrams, fields[0], 0, idfMap), 16 * idf + 15 + 18 + 0.5 + 4);
  assert.equal(scoreNode("hoàn tiền", terms, bigrams, fields[1], 2, idfMap), 4 * idf + 15 + 5 + 1);
});

test("a term buried inside a token scores nothing", () => {
  // "an" sits inside "thanh" and "toan" but starts neither.
  const fields = [fieldsFor({ title: "Thanh toán" })];
  const terms = tokenize("an", { dropStopwords: true });

  assert.equal(scoreNode("an", terms, buildBigrams(terms), fields[0], 2, buildIdf(terms, fields)), 0);
});

test("a term inside a content token adds nothing", () => {
  const fields = [fieldsFor({ content: "thanh thanh thanh" })];
  const terms = tokenize("anh", { dropStopwords: true });

  assert.equal(scoreNode("anh", terms, buildBigrams(terms), fields[0], 2, buildIdf(terms, fields)), 0);
});

test("a token prefix still scores, at half weight", () => {
  // A prefix must keep scoring rather than merely rank lower: a zero-scoring node is
  // dropped outright by retrievePageIndexNodes.
  const fields = [fieldsFor({ title: "Pay" }), fieldsFor({ title: "Payment" })];
  const terms = tokenize("pay", { dropStopwords: true });
  const idfMap = buildIdf(terms, fields);
  const bigrams = buildBigrams(terms);
  const idf = Math.log(1 + 2 / 3);

  assert.equal(scoreNode("pay", terms, bigrams, fields[0], 2, idfMap), 8 * idf + 15);
  assert.equal(scoreNode("pay", terms, bigrams, fields[1], 2, idfMap), 4 * idf + 15);
});

test("an adjacent pair scores even when the whole phrase does not", () => {
  const fields = [fieldsFor({ title: "Hóa đơn bán lẻ" }), fieldsFor({ title: "Hóa chất và đơn hàng" })];
  const terms = tokenize("hóa đơn cho khách", { dropStopwords: true });
  const idfMap = buildIdf(terms, fields);
  const bigrams = buildBigrams(terms);

  const adjacent = scoreNode("hóa đơn cho khách", terms, bigrams, fields[0], 2, idfMap);
  const apart = scoreNode("hóa đơn cho khách", terms, bigrams, fields[1], 2, idfMap);

  // Both nodes match the same tokens with the same IDF; only the title bigram separates them.
  assert.ok(adjacent > apart);
  assert.equal(Number((adjacent - apart).toFixed(9)), 4);
});
