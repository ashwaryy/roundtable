export interface CanonicalTouched {
  filesAddedOrUpdated?: string[]
  filesDeleted?: string[]
  rootsAddedOrUpdated?: string[]
  rootsDeleted?: string[]
}

function unique(paths: string[] | undefined): string[] | undefined {
  if (!paths || paths.length === 0) return undefined
  return [...new Set(paths)]
}

export function mergeTouched(...items: Array<CanonicalTouched | null | undefined>): CanonicalTouched {
  const merged: Required<CanonicalTouched> = {
    filesAddedOrUpdated: [],
    filesDeleted: [],
    rootsAddedOrUpdated: [],
    rootsDeleted: [],
  }

  for (const item of items) {
    if (!item) continue
    merged.filesAddedOrUpdated.push(...(item.filesAddedOrUpdated ?? []))
    merged.filesDeleted.push(...(item.filesDeleted ?? []))
    merged.rootsAddedOrUpdated.push(...(item.rootsAddedOrUpdated ?? []))
    merged.rootsDeleted.push(...(item.rootsDeleted ?? []))
  }

  return {
    filesAddedOrUpdated: unique(merged.filesAddedOrUpdated),
    filesDeleted: unique(merged.filesDeleted),
    rootsAddedOrUpdated: unique(merged.rootsAddedOrUpdated),
    rootsDeleted: unique(merged.rootsDeleted),
  }
}
