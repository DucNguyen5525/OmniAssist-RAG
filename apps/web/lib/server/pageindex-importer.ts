import { buildPageIndexArtifact } from "./pageindex-artifact";
import { flattenPageIndexTree, type PageIndexProducer } from "./pageindex-flatten";
import { upsertDocumentWithNodes } from "./repository";
import { uploadJsonToR2 } from "./r2";

export interface ImportPageIndexInput {
  title: string;
  slug: string;
  tags?: string[];
  version?: string;
  producer?: PageIndexProducer;
  producerVersion?: string;
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
  if (!nodes.some((node) => node.content.trim().length > 0)) {
    throw new Error(
      "The PageIndex tree contains no evidence text. Regenerate it with --if-add-node-text yes."
    );
  }

  let indexFileUrl = input.indexFileUrl;
  if (input.backupToR2) {
    const key = `pageindex/${input.slug}/${Date.now()}-index.json`;
    indexFileUrl = await uploadJsonToR2(key, input.indexJson);
  }
  const artifact = buildPageIndexArtifact(input.indexJson, {
    producer: input.producer,
    producerVersion: input.producerVersion,
    externalArtifactAvailable: Boolean(indexFileUrl)
  });

  return upsertDocumentWithNodes({
    title: input.title,
    slug: input.slug,
    sourceFileUrl: input.sourceFileUrl,
    indexFileUrl,
    version: input.version,
    tags: input.tags ?? [],
    nodes,
    artifact
  });
}
