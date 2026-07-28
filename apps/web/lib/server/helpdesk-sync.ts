import type {
  Helpdesk,
  HelpdeskDocument,
  HelpdeskSyncSnapshot,
  PageIndexNode
} from "@helpdesk/shared";
import { createHash } from "node:crypto";
import {
  getHelpdeskBySlug,
  getSyncNodesForDocuments,
  listReadyDocuments,
  serializeDocument,
  serializeNode,
  toObjectId
} from "./repository";

export class HelpdeskSyncError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export interface HelpdeskSyncDependencies {
  getHelpdesk(slug: string): Promise<Helpdesk | null>;
  listLinkedReadyDocuments(slugs: string[]): Promise<HelpdeskDocument[]>;
  listDocumentNodes(documentIds: string[]): Promise<PageIndexNode[]>;
  now(): Date;
}

const defaultDependencies: HelpdeskSyncDependencies = {
  getHelpdesk: getHelpdeskBySlug,
  listLinkedReadyDocuments: async (slugs) => {
    const documents = await listReadyDocuments({ slugs });
    return documents.map(serializeDocument);
  },
  listDocumentNodes: async (documentIds) => {
    const nodes = await getSyncNodesForDocuments(
      documentIds.map(toObjectId)
    );
    return nodes.map(serializeNode);
  },
  now: () => new Date()
};

export async function buildHelpdeskSyncSnapshot(
  slug: string,
  dependencies: HelpdeskSyncDependencies = defaultDependencies
): Promise<HelpdeskSyncSnapshot> {
  const helpdesk = await dependencies.getHelpdesk(slug);
  if (!helpdesk) {
    throw new HelpdeskSyncError("Helpdesk not found", 404);
  }
  if (helpdesk.retrievalMode !== "pageindex") {
    throw new HelpdeskSyncError(
      "Only PageIndex helpdesks can be synchronized",
      409
    );
  }

  const requestedDocumentSlugs = [
    ...new Set(helpdesk.documentSlugs ?? [])
  ].sort();
  const allowedDocumentSlugs = new Set(requestedDocumentSlugs);
  const documents =
    requestedDocumentSlugs.length === 0
      ? []
      : (
          await dependencies.listLinkedReadyDocuments(
            requestedDocumentSlugs
          )
        ).filter((document) => allowedDocumentSlugs.has(document.slug));
  documents.sort((left, right) => left.slug.localeCompare(right.slug));

  const documentIds = documents.map((document) => document.id).sort();
  const allowedDocumentIds = new Set(documentIds);
  const nodes =
    documentIds.length === 0
      ? []
      : (await dependencies.listDocumentNodes(documentIds))
          .filter((node) => allowedDocumentIds.has(node.documentId))
          .sort((left, right) => {
            const documentComparison = left.documentId.localeCompare(
              right.documentId
            );
            return documentComparison !== 0
              ? documentComparison
              : left.nodeId.localeCompare(right.nodeId);
          });

  const snapshotVersion = createHash("sha256")
    .update(
      JSON.stringify({
        helpdeskUpdatedAt: helpdesk.updatedAt,
        requestedDocumentSlugs,
        documents: documents.map((document) => ({
          id: document.id,
          slug: document.slug,
          contentHash: document.contentHash,
          updatedAt: document.updatedAt
        })),
        nodes: nodes.map((node) => ({
          id: node.id,
          documentId: node.documentId,
          nodeId: node.nodeId,
          updatedAt: node.updatedAt
        }))
      })
    )
    .digest("hex");

  return {
    schemaVersion: 1,
    helpdeskSlug: helpdesk.slug,
    helpdeskUpdatedAt: helpdesk.updatedAt,
    requestedDocumentSlugs,
    snapshotVersion,
    generatedAt: dependencies.now().toISOString(),
    documents,
    nodes
  };
}
