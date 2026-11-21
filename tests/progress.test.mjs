import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeProgress, withCompletion, withFavorite } from '../src/lib/progress.ts'

test('conclusão e favorita atualizam apenas o jogo escolhido', () => {
  const done = withCompletion({}, 4, '2026-11-21T10:00:00.000Z')
  const favorite = withFavorite(done, 4, true, '2026-11-21T10:01:00.000Z')
  assert.equal(favorite['4'].completions, 1)
  assert.equal(favorite['4'].favorite, true)
  assert.equal(favorite['4'].favoriteChangedAt, '2026-11-21T10:01:00.000Z')
  assert.equal(favorite['1'], undefined)
})

test('sincronização preserva a maior conclusão e a favorita mais recente', () => {
  const merged = mergeProgress(
    { '1': { completions: 2, lastPlayed: '2026-11-20T10:00:00.000Z', favorite: false, favoriteChangedAt: '2026-11-20T10:00:00.000Z' } },
    { '1': { completions: 3, lastPlayed: '2026-11-21T10:00:00.000Z', favorite: true, favoriteChangedAt: '2026-11-21T10:00:00.000Z' } },
  )
  assert.deepEqual(merged['1'], { completions: 3, lastPlayed: '2026-11-21T10:00:00.000Z', favorite: true, favoriteChangedAt: '2026-11-21T10:00:00.000Z' })
})
