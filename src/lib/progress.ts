export interface GameProgress {
  completions: number
  lastPlayed: string | null
  favorite: boolean
  favoriteChangedAt: string | null
}

export type ProgressMap = Record<string, GameProgress>

const STORAGE_KEY = 'mundo-da-laurinha:progress:v1'
const emptyRecord = (): GameProgress => ({ completions: 0, lastPlayed: null, favorite: false, favoriteChangedAt: null })

export function readProgress(): ProgressMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Partial<GameProgress>>
    return Object.fromEntries(Object.entries(parsed).map(([id, record]) => [id, {
      completions: Math.max(0, Number(record.completions) || 0),
      lastPlayed: typeof record.lastPlayed === 'string' ? record.lastPlayed : null,
      favorite: record.favorite === true,
      favoriteChangedAt: typeof record.favoriteChangedAt === 'string' ? record.favoriteChangedAt : null,
    }]))
  } catch {
    return {}
  }
}

export function writeProgress(progress: ProgressMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
}

export function withCompletion(progress: ProgressMap, gameId: number, now = new Date().toISOString()): ProgressMap {
  const current = progress[String(gameId)] ?? emptyRecord()
  return { ...progress, [gameId]: { ...current, completions: current.completions + 1, lastPlayed: now } }
}

export function withFavorite(progress: ProgressMap, gameId: number, favorite: boolean, now = new Date().toISOString()): ProgressMap {
  const current = progress[String(gameId)] ?? emptyRecord()
  return { ...progress, [gameId]: { ...current, favorite, favoriteChangedAt: now } }
}

export function mergeProgress(local: ProgressMap, remote: ProgressMap): ProgressMap {
  const merged: ProgressMap = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const left = local[key] ?? emptyRecord()
    const right = remote[key] ?? emptyRecord()
    const localWinsFavorite = (left.favoriteChangedAt ?? '') >= (right.favoriteChangedAt ?? '')
    merged[key] = {
      completions: Math.max(left.completions, right.completions),
      lastPlayed: [left.lastPlayed, right.lastPlayed].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null,
      favorite: localWinsFavorite ? left.favorite : right.favorite,
      favoriteChangedAt: localWinsFavorite ? left.favoriteChangedAt : right.favoriteChangedAt,
    }
  }
  return merged
}

export function clearProgress(): void {
  localStorage.removeItem(STORAGE_KEY)
}
