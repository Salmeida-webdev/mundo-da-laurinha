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

test('cada tipo de brincadeira tem os dados exigidos pelo controle correspondente', () => {
  const choiceModes = new Set(['choice', 'movement', 'path', 'color', 'story', 'rhyme', 'sort', 'observe', 'memory'])

  for (const game of games) {
    if (choiceModes.has(game.mode)) {
      assert.ok(game.choices?.length >= 2, `${game.title} precisa oferecer escolhas`)
      assert.ok(game.choices.every((choice) => choice.label.trim() && choice.symbol.trim()), `${game.title} tem uma opção incompleta`)
      assert.equal(new Set(game.choices.map((choice) => choice.label)).size, game.choices.length, `${game.title} tem opções duplicadas`)
    }

    if (game.mode === 'sequence') {
      assert.ok(game.sequence?.length >= 2, `${game.title} precisa de uma sequência reordenável`)
      assert.equal(new Set(game.sequence).size, game.sequence.length, `${game.title} tem etapas duplicadas`)
    }

    if (game.mode === 'memory') assert.ok((game.choices?.length ?? 0) >= 3, 'A brincadeira de memória precisa ter ao menos três cartões')
    if (['draw', 'sound', 'shapes'].includes(game.mode)) assert.ok(!game.choices, `${game.title} deve usar o controle dedicado ao modo ${game.mode}`)
  }
})
