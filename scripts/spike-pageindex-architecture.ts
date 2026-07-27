import fs from "node:fs/promises";
import path from "node:path";
import { closeMongoClient } from "../apps/web/lib/server/mongodb";
import {
  buildCompactOutline,
  buildPageIndexForest,
  type PageIndexTreeNode
} from "../apps/web/lib/server/pageindex-tree";
import {
  getAllNodesForDocuments,
  listReadyDocuments
} from "../apps/web/lib/server/repository";

async function main() {
  await loadRootEnv();
  const documents = await listReadyDocuments();
  const nodes = await getAllNodesForDocuments(documents.map((document) => document._id));
  const forest = buildPageIndexForest(documents, nodes);
  const outline30k = buildCompactOutline(forest, 30_000);
  const outline100k = buildCompactOutline(forest, 100_000);
  const compactOutline = buildCompactOutline(forest, 50_000, { compactRefs: true });
  const nestedTree = forest.roots.map(serializeTreeNode);
  const flatBytes = Buffer.byteLength(JSON.stringify(nodes), "utf8");
  const nestedBytes = Buffer.byteLength(JSON.stringify(nestedTree), "utf8");
  const mongoDocumentLimitBytes = 16 * 1024 * 1024;

  const artifact = {
    timestamp: new Date().toISOString(),
    candidateA: {
      nodeCount: nodes.length,
      rootCount: forest.roots.length,
      outline30k: {
        includedNodes: outline30k.nodeCount,
        totalNodes: nodes.length,
        coverage: round(outline30k.nodeCount / Math.max(nodes.length, 1)),
        truncated: outline30k.truncated,
        chars: outline30k.outline.length,
        includesTicketWorkflow: outline30k.outline.includes("[tech-support-manual::ticket-workflow]")
      },
      outline100k: {
        includedNodes: outline100k.nodeCount,
        totalNodes: nodes.length,
        coverage: round(outline100k.nodeCount / Math.max(nodes.length, 1)),
        truncated: outline100k.truncated,
        chars: outline100k.outline.length,
        includesTicketWorkflow: outline100k.outline.includes("[tech-support-manual::ticket-workflow]")
      },
      compactOutline50k: {
        includedNodes: compactOutline.nodeCount,
        totalNodes: nodes.length,
        coverage: round(compactOutline.nodeCount / Math.max(nodes.length, 1)),
        truncated: compactOutline.truncated,
        chars: compactOutline.outline.length
      }
    },
    candidateB: {
      rawTreeSourceAvailable: documents.every((document) => Boolean(document.indexFileUrl)),
      documentsWithoutRawTreeSource: documents
        .filter((document) => !document.indexFileUrl)
        .map((document) => document.slug),
      reconstructedFlatBytes: flatBytes,
      reconstructedNestedTreeBytes: nestedBytes,
      mongoDocumentLimitBytes,
      nestedTreeLimitUsage: round(nestedBytes / mongoDocumentLimitBytes),
      fitsSingleMongoDocument: nestedBytes < mongoDocumentLimitBytes,
      caveat: "Reconstructed tree is a feasibility proxy; flattened nodes cannot restore upstream metadata that was not persisted."
    },
    candidateC: {
      publicSelfHostedRetrievalEngine: false,
      availableTools: ["get_document", "get_document_structure", "get_page_content"],
      reference: "C:\\.dev\\.ref\\.rag\\PageIndex",
      implication: "A separate service would wrap the same tree/tool pattern and add network/operations without an additional public retrieval engine."
    }
  };

  const outputPath = path.resolve("evals/results/architecture-feasibility.json");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: path.relative(process.cwd(), outputPath), ...artifact }, null, 2));
}

function serializeTreeNode(treeNode: PageIndexTreeNode): Record<string, unknown> {
  return {
    nodeId: treeNode.node.nodeId,
    parentNodeId: treeNode.node.parentNodeId,
    title: treeNode.node.title,
    summary: treeNode.node.summary,
    content: treeNode.node.content,
    path: treeNode.node.path,
    level: treeNode.node.level,
    pageStart: treeNode.node.pageStart,
    pageEnd: treeNode.node.pageEnd,
    sourceRef: treeNode.node.sourceRef,
    children: treeNode.children.map(serializeTreeNode)
  };
}

async function loadRootEnv() {
  try {
    const contents = await fs.readFile(path.resolve(".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = stripQuotes(match[2]);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function stripQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function round(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoClient().catch(() => undefined);
  });
