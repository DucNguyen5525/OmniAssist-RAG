import fs from "node:fs/promises";
import path from "node:path";
import { importPageIndex } from "../apps/web/lib/server/pageindex-importer";

interface Args {
  file?: string;
  title?: string;
  slug?: string;
  tags?: string;
  version?: string;
  producer?: "vectify-pageindex" | "internal-md-converter" | "unknown";
  producerVersion?: string;
  sourceFileUrl?: string;
  indexFileUrl?: string;
  backupToR2?: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || !args.title || !args.slug) {
    throw new Error('Usage: npm run import:pageindex -- --file ./data/index.json --title "Warranty Policy" --slug warranty-policy --tags helpdesk,warranty');
  }

  const indexJson = JSON.parse(await fs.readFile(path.resolve(args.file), "utf8"));
  const document = await importPageIndex({
    title: args.title,
    slug: args.slug,
    tags: splitTags(args.tags),
    version: args.version,
    producer: args.producer,
    producerVersion: args.producerVersion,
    sourceFileUrl: args.sourceFileUrl,
    indexFileUrl: args.indexFileUrl,
    backupToR2: args.backupToR2,
    indexJson
  });

  console.log(JSON.stringify({ imported: document }, null, 2));
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith("--")) continue;
    if (key === "--backup-to-r2") {
      args.backupToR2 = true;
      continue;
    }
    if (!value || value.startsWith("--")) continue;
    i += 1;
    const name = toCamelCase(key.slice(2)) as keyof Args;
    args[name] = value as never;
  }
  return args;
}

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function splitTags(value?: string) {
  return value?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
