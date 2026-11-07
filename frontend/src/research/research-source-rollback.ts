import { err, ok, type Result } from 'neverthrow'
import * as Y from 'yjs'

import {
  deleteSource,
  listEvidence,
  listFindings,
  listSources,
  type Source,
  updateSource,
} from '#article/index'

type ResearchSourceSnapshot = {
  id: string
  source?: Source
  saved?: Source
}

export function snapshotResearchSources(
  plans: { id: string; existing?: Source }[],
): ResearchSourceSnapshot[] {
  return plans.map(({ id, existing }) => ({
    id,
    ...(existing === undefined ? {} : { source: existing }),
  }))
}

export function captureSavedResearchSources(
  doc: Y.Doc,
  snapshots: ResearchSourceSnapshot[],
): ResearchSourceSnapshot[] {
  const sources = new Map(listSources(doc).map((source) => [source.id, source]))
  return snapshots.map((snapshot) => {
    const saved = sources.get(snapshot.id)
    return saved === undefined ? snapshot : { ...snapshot, saved }
  })
}

function sameSource(left: Source, right: Source): boolean {
  return (
    left.kind === right.kind &&
    left.title === right.title &&
    left.url === right.url &&
    left.fileName === right.fileName &&
    left.checkedAt === right.checkedAt &&
    left.status === right.status &&
    left.summary === right.summary
  )
}

export function restoreResearchSources(
  doc: Y.Doc,
  snapshots: ResearchSourceSnapshot[],
): Result<string[], Error> {
  return doc.transact(() => {
    const sources = new Map(
      listSources(doc).map((source) => [source.id, source]),
    )
    const evidenceSourceIds = new Set(
      listEvidence(doc).flatMap(({ sourceId }) =>
        sourceId === null ? [] : [sourceId],
      ),
    )
    const preservedSourceIds: string[] = []
    for (const snapshot of snapshots) {
      const current = sources.get(snapshot.id)
      if (current === undefined) continue
      if (snapshot.source === undefined) {
        if (
          snapshot.saved === undefined ||
          !sameSource(current, snapshot.saved) ||
          listFindings(doc, snapshot.id).length > 0 ||
          evidenceSourceIds.has(snapshot.id)
        ) {
          preservedSourceIds.push(snapshot.id)
          continue
        }
        const deleteResult = deleteSource(doc, snapshot.id)
        if (deleteResult.isErr()) return err(deleteResult.error)
        continue
      }
      if (snapshot.saved === undefined) continue

      const source = snapshot.source
      const restored = {
        kind: current.kind === snapshot.saved.kind ? source.kind : current.kind,
        title:
          current.title === snapshot.saved.title ? source.title : current.title,
        url: current.url === snapshot.saved.url ? source.url : current.url,
        fileName:
          current.fileName === snapshot.saved.fileName
            ? source.fileName
            : current.fileName,
        checkedAt:
          current.checkedAt === snapshot.saved.checkedAt
            ? source.checkedAt
            : current.checkedAt,
        status:
          current.status === snapshot.saved.status
            ? source.status
            : current.status,
        summary:
          current.summary === snapshot.saved.summary
            ? source.summary
            : current.summary,
      }
      const updateResult = updateSource(doc, snapshot.id, restored)
      if (updateResult.isErr()) return err(updateResult.error)
    }
    return ok(preservedSourceIds)
  })
}
