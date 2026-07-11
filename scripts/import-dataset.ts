import path from "node:path";
import * as XLSX from "xlsx";
import type { DatasetColumn } from "@helpdesk/shared";
import { upsertDatasetWithRows, type DatasetCellValue } from "../apps/web/lib/server/repository";

interface Args {
  file?: string;
  slug?: string;
  title?: string;
  source?: string;
  sheet?: string;
}

const MAX_CATEGORIES = 30;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.slug || !args.title) {
    throw new Error(
      'Usage: npm run import:dataset -- --file ./Papers/paper1/.../baseline.csv --slug dengue-baseline --title "Dengue baseline" [--source paper1] [--sheet Sheet1]'
    );
  }

  const filePath = path.resolve(args.file);
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = args.sheet ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet '${sheetName}' not found. Available: ${workbook.SheetNames.join(", ")}`);

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
  if (rawRows.length === 0) throw new Error("No data rows found in file");

  const headers = Object.keys(rawRows[0]);
  const rows: Array<Record<string, DatasetCellValue>> = rawRows.map((raw) => {
    const row: Record<string, DatasetCellValue> = {};
    for (const header of headers) {
      row[header] = normalizeCell(raw[header]);
    }
    return row;
  });

  const columns = inferColumns(headers, rows);

  const dataset = await upsertDatasetWithRows({
    datasetSlug: args.slug,
    title: args.title,
    source: args.source ?? path.basename(filePath),
    columns,
    rows
  });

  console.log(
    JSON.stringify(
      {
        imported: dataset.slug,
        title: dataset.title,
        rowCount: dataset.rowCount,
        columns: dataset.columns.map((c) => `${c.name}:${c.type}`)
      },
      null,
      2
    )
  );
  process.exit(0);
}

function normalizeCell(value: unknown): DatasetCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (text === "" || text.toUpperCase() === "NA" || text.toUpperCase() === "NULL") return null;
  const num = Number(text);
  if (text !== "" && !Number.isNaN(num)) return num;
  return text;
}

function inferColumns(headers: string[], rows: Array<Record<string, DatasetCellValue>>): DatasetColumn[] {
  return headers.map((name) => {
    let hasValue = false;
    let allNumeric = true;
    const categories = new Set<string>();

    for (const row of rows) {
      const cell = row[name];
      if (cell === null) continue;
      hasValue = true;
      if (typeof cell === "number") {
        categories.add(String(cell));
      } else {
        allNumeric = false;
        categories.add(cell);
      }
    }

    const type: DatasetColumn["type"] = hasValue && allNumeric ? "number" : "category";
    const column: DatasetColumn = { name, label: name, type };
    if (type === "category" && categories.size <= MAX_CATEGORIES) {
      column.categories = [...categories].sort();
    }
    return column;
  });
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
