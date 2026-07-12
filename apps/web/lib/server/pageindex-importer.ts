import { generateDocSummary } from "./doc-router";
import { flattenPageIndexTree } from "./pageindex-flatten";
import { upsertDocumentWithNodes } from "./repository";
import { uploadJsonToR2 } from "./r2";

export interface ImportPageIndexInput {
  title: string;
  slug: string;
  tags?: string[];
  version?: string;
  sourceFileUrl?: string;
  indexFileUrl?: string;
  indexJson: unknown;
  backupToR2?: boolean;
}

export async function importPageIndex(input: ImportPageIndexInput) {
  const nodes = flattenPageIndexTree({ indexJson: input.indexJson });
  if (nodes.length === 0) {
    throw new Error("No PageIndex nodes were found in the provided JSON.");
  }

  let indexFileUrl = input.indexFileUrl;
  if (input.backupToR2) {
    const key = `pageindex/${input.slug}/${Date.now()}-index.json`;
    indexFileUrl = await uploadJsonToR2(key, input.indexJson);
  }

  // Document-level summary powers 2-stage doc routing; import must not fail because of it.
  let docSummary: string | undefined;
  try {
    docSummary = await generateDocSummary(input.title, nodes);
  } catch (error) {
    console.warn("Doc summary generation failed:", error instanceof Error ? error.message : error);
  }

  return upsertDocumentWithNodes({
    title: input.title,
    slug: input.slug,
    sourceFileUrl: input.sourceFileUrl,
    indexFileUrl,
    version: input.version,
    tags: input.tags ?? [],
    docSummary,
    nodes
  });
}
