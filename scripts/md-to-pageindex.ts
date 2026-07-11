import fs from "node:fs";
import path from "node:path";

interface Args {
  file?: string;
  out?: string;
  title?: string;
  "max-table-rows"?: string;
}

interface Section {
  title: string;
  level: number;
  contentLines: string[];
  children: Section[];
}

interface PageIndexNode {
  nodeId: string;
  title: string;
  level: number;
  content: string;
  children: PageIndexNode[];
}

const DEFAULT_MAX_TABLE_ROWS = 15;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error(
      'Usage: npx tsx scripts/md-to-pageindex.ts --file ".data/Docs/Tech Support Manual-extracted/Tech Support Manual.md" [--out output.json] [--title "Tech Support Manual"] [--max-table-rows 15]'
    );
  }

  const filePath = path.resolve(args.file);
  const baseName = path.basename(filePath, path.extname(filePath));
  const docTitle = args.title ?? baseName;
  const outFile = path.resolve(args.out ?? path.join(path.dirname(filePath), `${baseName}.pageindex.json`));
  const maxTableRows = args["max-table-rows"] ? Number(args["max-table-rows"]) : DEFAULT_MAX_TABLE_ROWS;
  if (!Number.isInteger(maxTableRows) || maxTableRows < 2) {
    throw new Error("--max-table-rows must be an integer >= 2");
  }

  const markdown = fs.readFileSync(filePath, "utf8");
  const sections = parseSections(markdown.split(/\r?\n/), docTitle);

  const usedIds = new Set<string>();
  const stats = { nodes: 0, tableChunkNodes: 0, maxLevel: 0 };
  const nodes = sections.map((section) => toPageIndexNode(section, [], usedIds, maxTableRows, stats));

  fs.writeFileSync(outFile, JSON.stringify({ title: docTitle, nodes }, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        input: filePath,
        output: outFile,
        rootNodes: nodes.length,
        totalNodes: stats.nodes,
        tableChunkNodes: stats.tableChunkNodes,
        maxLevel: stats.maxLevel,
        outputBytes: fs.statSync(outFile).size
      },
      null,
      2
    )
  );
}

function parseSections(lines: string[], docTitle: string): Section[] {
  const roots: Section[] = [];
  const stack: Section[] = [];
  let current: Section | undefined;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s*(.*)$/);
    if (!heading) {
      if (!current && line.trim()) {
        current = { title: docTitle, level: 1, contentLines: [], children: [] };
        roots.push(current);
        stack.push(current);
      }
      current?.contentLines.push(line);
      continue;
    }

    const title = cleanInlineMarkdown(heading[2]);
    // Google Docs export emits stray empty `#` headings; treat them as plain separators.
    if (!title) continue;

    const level = heading[1].length;
    const section: Section = { title, level, contentLines: [], children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length === 0) {
      roots.push(section);
    } else {
      stack[stack.length - 1].children.push(section);
    }
    stack.push(section);
    current = section;
  }

  return roots;
}

function toPageIndexNode(
  section: Section,
  parentPath: string[],
  usedIds: Set<string>,
  maxTableRows: number,
  stats: { nodes: number; tableChunkNodes: number; maxLevel: number }
): PageIndexNode {
  const currentPath = [...parentPath, section.title];
  const { inlineContent, tableChunks } = splitLargeTables(section.contentLines, maxTableRows);

  const node: PageIndexNode = {
    nodeId: uniqueId(slugify(currentPath.join(" ")), usedIds),
    title: section.title,
    level: section.level,
    content: cleanContent(inlineContent),
    children: []
  };
  stats.nodes += 1;
  stats.maxLevel = Math.max(stats.maxLevel, section.level);

  for (const chunk of tableChunks) {
    const chunkTitle = `${section.title} (rows ${chunk.startRow}-${chunk.endRow})`;
    node.children.push({
      nodeId: uniqueId(slugify([...currentPath, `rows ${chunk.startRow}-${chunk.endRow}`].join(" ")), usedIds),
      title: chunkTitle,
      level: section.level + 1,
      content: cleanContent(chunk.lines),
      children: []
    });
    stats.nodes += 1;
    stats.tableChunkNodes += 1;
    stats.maxLevel = Math.max(stats.maxLevel, section.level + 1);
  }

  for (const child of section.children) {
    node.children.push(toPageIndexNode(child, currentPath, usedIds, maxTableRows, stats));
  }

  return node;
}

interface TableChunk {
  startRow: number;
  endRow: number;
  lines: string[];
}

function splitLargeTables(lines: string[], maxTableRows: number): { inlineContent: string[]; tableChunks: TableChunk[] } {
  const inlineContent: string[] = [];
  const tableChunks: TableChunk[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].trimStart().startsWith("|")) {
      inlineContent.push(lines[i]);
      i += 1;
      continue;
    }

    const tableLines: string[] = [];
    while (i < lines.length && lines[i].trimStart().startsWith("|")) {
      tableLines.push(lines[i]);
      i += 1;
    }

    const hasSeparator = tableLines.length > 1 && /^\|[\s:|-]+\|?\s*$/.test(tableLines[1]);
    const headerLines = tableLines.slice(0, hasSeparator ? 2 : 1);
    const dataRows = tableLines.slice(headerLines.length).filter((row) => !isEmptyTableRow(row));

    if (dataRows.length <= maxTableRows) {
      inlineContent.push(...headerLines, ...dataRows);
      continue;
    }

    for (let start = 0; start < dataRows.length; start += maxTableRows) {
      const rows = dataRows.slice(start, start + maxTableRows);
      tableChunks.push({
        startRow: start + 1,
        endRow: start + rows.length,
        lines: [...headerLines, ...rows]
      });
    }
  }

  return { inlineContent, tableChunks };
}

function isEmptyTableRow(row: string) {
  return row.replace(/[|\s]/g, "") === "";
}

function cleanInlineMarkdown(value: string) {
  return unescapeMarkdown(value)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/#/g, "")
    .trim();
}

function cleanContent(lines: string[]) {
  return unescapeMarkdown(lines.join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Google Docs MD export escapes punctuation (`\-`, `\!`, `\>`); unescape all except `|` to keep tables intact.
function unescapeMarkdown(value: string) {
  return value.replace(/\\([\\`*_{}\[\]()#+\-.!>~<$&%=])/g, "$1");
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 120) || "node"
  );
}

function uniqueId(base: string, usedIds: Set<string>) {
  let candidate = base;
  let counter = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) continue;
    i += 1;
    const name = key.slice(2) as keyof Args;
    args[name] = value as never;
  }
  return args;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
