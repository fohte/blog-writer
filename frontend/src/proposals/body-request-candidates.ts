import type {
  BodyRequestCandidate,
  BodyRequestTarget,
} from '#components/body-request-view'

export type BodyRequestSituation = {
  target: BodyRequestTarget
  hasHeading: boolean
  hasPremise: boolean
}

type EditCandidate = BodyRequestCandidate & {
  targets: readonly BodyRequestTarget[]
  needsPremise?: boolean
}

const editCandidates: readonly EditCandidate[] = [
  {
    id: 'concise',
    label: '簡潔にする',
    group: 'edit',
    targets: ['selection', 'paragraph'],
  },
  {
    id: 'add-example',
    label: '例を 1 つ足す',
    group: 'edit',
    // A selection is replaced in place, so an example would land inside the selected phrase.
    targets: ['paragraph', 'insertion'],
  },
  {
    id: 'smooth-flow',
    label: '前後とのつながりを直す',
    group: 'edit',
    targets: ['selection', 'paragraph'],
  },
  {
    id: 'follow-premise',
    label: '前提に沿って直す',
    group: 'edit',
    targets: ['selection', 'paragraph'],
    needsPremise: true,
  },
]

export function editCandidatesFor({
  target,
  hasPremise,
}: BodyRequestSituation): readonly BodyRequestCandidate[] {
  return editCandidates.filter(
    ({ targets, needsPremise = false }) =>
      targets.includes(target) && (!needsPremise || hasPremise),
  )
}
