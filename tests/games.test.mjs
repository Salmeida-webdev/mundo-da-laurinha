import test from 'node:test'
import assert from 'node:assert/strict'
import { games } from '../src/data/games.ts'

test('o catálogo mantém exatamente 20 brincadeiras identificáveis', () => {
  assert.equal(games.length, 20)
  assert.deepEqual(games.map((game) => game.id), Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(new Set(games.map((game) => game.slug)).size, 20)
  assert.equal(new Set(games.map((game) => game.title)).size, 20)
})

test('toda brincadeira tem uma interação, orientação gentil e conteúdo', () => {
  for (const game of games) {
    assert.ok(game.title.trim())
    assert.ok(game.short.trim())
    assert.ok(game.prompt.trim())
    assert.ok(game.note.trim())
    assert.ok(['choice', 'sequence', 'movement', 'path', 'draw', 'color', 'sound', 'shapes', 'story', 'rhyme', 'sort', 'observe', 'memory'].includes(game.mode))
  }
})
