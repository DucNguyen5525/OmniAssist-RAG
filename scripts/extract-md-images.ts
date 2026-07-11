import fs from "node:fs";
import path from "node:path";

interface Args {
  file?: string;
  "out-dir"?: string;
}

interface ExtractedImage {
  label: string;
  fileName: string;
  bytes: number;
}

const MIME_EXTENSIONS: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
  "svg+xml": "svg"
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error(
      'Usage: npm run extract:md-images -- --file ".data/Docs/Tech Support Manual.md" [--out-dir ".data/Docs/extracted"]'
    );
  }

  const filePath = path.resolve(args.file);
  const baseName = path.basename(filePath, path.extname(filePath));
  const outDir = path.resolve(args["out-dir"] ?? path.join(path.dirname(filePath), `${baseName}-extracted`));
  const imagesDir = path.join(outDir, "images");

  const markdown = fs.readFileSync(filePath, "utf8");
  fs.mkdirSync(imagesDir, { recursive: true });

  // Google Docs MD export: inline refs `![][image1]` plus definitions `[image1]: <data:image/png;base64,...>`.
  const definitionPattern = /^\[([^\]\n]+)\]:\s*<data:image\/([a-z0-9+.-]+);base64,([^>]+)>[ \t]*\r?\n?/gim;
  const labelToFile = new Map<string, string>();
  const extracted: ExtractedImage[] = [];

  const withoutDefinitions = markdown.replace(definitionPattern, (_match, label: string, mime: string, base64: string) => {
    const extension = MIME_EXTENSIONS[mime.toLowerCase()] ?? "bin";
    const fileName = `${label}.${extension}`;
    const buffer = Buffer.from(base64, "base64");
    fs.writeFileSync(path.join(imagesDir, fileName), buffer);
    labelToFile.set(label, fileName);
    extracted.push({ label, fileName, bytes: buffer.length });
    return "";
  });

  let replacedRefs = 0;
  const unresolvedLabels = new Set<string>();
  const cleaned = withoutDefinitions.replace(/!\[([^\]]*)\]\[([^\]\n]+)\]/g, (match, alt: string, label: string) => {
    const fileName = labelToFile.get(label);
    if (!fileName) {
      unresolvedLabels.add(label);
      return match;
    }
    replacedRefs += 1;
    return `![${alt || label}](images/${fileName})`;
  });

  const outFile = path.join(outDir, `${baseName}.md`);
  fs.writeFileSync(outFile, cleaned, "utf8");

  console.log(
    JSON.stringify(
      {
        input: filePath,
        output: outFile,
        imagesDir,
        imagesExtracted: extracted.length,
        imagesTotalBytes: extracted.reduce((sum, image) => sum + image.bytes, 0),
        inlineRefsReplaced: replacedRefs,
        unresolvedLabels: [...unresolvedLabels],
        cleanedMarkdownBytes: Buffer.byteLength(cleaned, "utf8")
      },
      null,
      2
    )
  );
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
