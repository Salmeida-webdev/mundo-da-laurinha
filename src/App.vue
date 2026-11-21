<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { Game } from './data/games'
import { games } from './data/games'
import { api } from './lib/api'
import type { AdultSession } from './lib/api'
import type { ProgressMap } from './lib/progress'
import { clearProgress, mergeProgress, readProgress, withCompletion, withFavorite, writeProgress } from './lib/progress'

const progress = reactive<ProgressMap>(readProgress())
const selectedGame = ref<Game | null>(null)
const selectedArea = ref('Todas')
const favoritesOnly = ref(false)
const parentOpen = ref(false)
const session = ref<AdultSession | null>(null)
const setupAvailable = ref(false)
const loginMode = ref<'login' | 'setup' | 'recover'>('login')
const email = ref('')
const password = ref('')
const setupToken = ref('')
const formError = ref('')
const formBusy = ref(false)
const syncing = ref(false)
const online = ref(navigator.onLine)
const syncLabel = ref('Salvo neste aparelho')
const chosen = ref<number | null>(null)
const orderedItems = ref<string[]>([])
const shapePieces = ref<string[]>([])
const completedThisPlay = ref(false)
const finishedThisPlay = ref(false)
const feedback = ref('')
const memoryTarget = [0, 2, 1]
const memoryStarted = ref(false)
const memoryPicks = ref<number[]>([])
const selectedItems = ref<string[]>([])
const canvas = ref<HTMLCanvasElement | null>(null)
const brushColor = ref('#d95a86')
const isDrawing = ref(false)
let installPrompt: Event | null = null

const areas = ['Todas', ...new Set(games.map((game) => game.area))]
const visibleGames = computed(() => games.filter((game) => {
  const areaMatches = selectedArea.value === 'Todas' || game.area === selectedArea.value
  const favoriteMatches = !favoritesOnly.value || Boolean(progress[String(game.id)]?.favorite)
  return areaMatches && favoriteMatches
}))
const completedCount = computed(() => games.filter((game) => (progress[String(game.id)]?.completions ?? 0) > 0).length)
const favoriteCount = computed(() => games.filter((game) => progress[String(game.id)]?.favorite).length)
const accents = ['#f3d9e1', '#e9e5d3', '#eee1d6', '#eadff1', '#e2ebdc']
const emojis = ['🌷', '🧸', '🎈', '🍓', '🦋', '🪄', '🖍️', '🌈', '🎶', '🔺', '📖', '🌦️', '🎵', '🧚', '🧺', '🍎', '🌱', '🔍', '🐸', '💃']
function cardAccent(id: number) { return accents[id % accents.length] }
function gameEmoji(id: number) { return emojis[id - 1] }

function openGame(game: Game) {
  selectedGame.value = game
  chosen.value = null
  orderedItems.value = game.sequence ? [...game.sequence] : []
  shapePieces.value = []
  completedThisPlay.value = false
  finishedThisPlay.value = false
  feedback.value = ''
  memoryStarted.value = false
  memoryPicks.value = []
  selectedItems.value = []
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function closeGame() {
  selectedGame.value = null
  feedback.value = ''
}

function markAction(message?: string) {
  completedThisPlay.value = true
  if (message) feedback.value = message
}

function choose(index: number, response?: string) {
  chosen.value = index
  feedback.value = response ?? ''
  markAction(response)
}

function startMemory() {
  memoryPicks.value = []
  memoryStarted.value = true
  feedback.value = ''
}

function chooseMemory(index: number) {
  if (!memoryStarted.value) return
  const picks = [...memoryPicks.value, index]
  memoryPicks.value = picks
  if (picks.length < memoryTarget.length) return
  memoryStarted.value = false
  if (picks.every((pick, position) => pick === memoryTarget[position])) {
    markAction('Você lembrou a sequência! Que memória curiosa. 💗')
  } else {
    feedback.value = 'Vamos olhar a sequência juntinhos mais uma vez. Sem pressa. 💗'
  }
}

function addShape(shape: string) {
  shapePieces.value = [...shapePieces.value, shape]
  markAction()
}

function toggleItem(label: string) {
  selectedItems.value = selectedItems.value.includes(label)
    ? selectedItems.value.filter((item) => item !== label)
    : [...selectedItems.value, label]
  completedThisPlay.value = selectedItems.value.length > 0
}

function reorder(index: number, offset: number) {
  const nextIndex = index + offset
  if (nextIndex < 0 || nextIndex >= orderedItems.value.length) return
  const next = [...orderedItems.value]
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  orderedItems.value = next
  markAction()
}

function startDrawing(event: PointerEvent) {
  if (!canvas.value) return
  isDrawing.value = true
  canvas.value.setPointerCapture(event.pointerId)
  const context = canvas.value.getContext('2d')
  if (!context) return
  const bounds = canvas.value.getBoundingClientRect()
  const scaleX = canvas.value.width / bounds.width
  const scaleY = canvas.value.height / bounds.height
  context.beginPath()
  context.moveTo((event.clientX - bounds.left) * scaleX, (event.clientY - bounds.top) * scaleY)
  context.strokeStyle = brushColor.value
  context.lineWidth = 12 * Math.max(scaleX, scaleY)
  context.lineCap = 'round'
  context.lineJoin = 'round'
}

function draw(event: PointerEvent) {
  if (!isDrawing.value || !canvas.value) return
  const context = canvas.value.getContext('2d')
  if (!context) return
  const bounds = canvas.value.getBoundingClientRect()
  const scaleX = canvas.value.width / bounds.width
  const scaleY = canvas.value.height / bounds.height
  context.lineTo((event.clientX - bounds.left) * scaleX, (event.clientY - bounds.top) * scaleY)
  context.stroke()
  markAction()
}

function stopDrawing() { isDrawing.value = false }

function clearCanvas() {
  const context = canvas.value?.getContext('2d')
  if (context && canvas.value) context.clearRect(0, 0, canvas.value.width, canvas.value.height)
  completedThisPlay.value = false
}

function playTone(frequency: number) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) {
    feedback.value = 'Seu aparelho não oferece áudio nesta tela. Podemos brincar só olhando os instrumentos.'
    markAction()
    return
  }
  const audio = new AudioContextClass()
  const oscillator = audio.createOscillator()
  const gain = audio.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.13, audio.currentTime + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.42)
  oscillator.connect(gain)
  gain.connect(audio.destination)
  oscillator.start()
  oscillator.stop(audio.currentTime + 0.44)
  oscillator.onended = () => { void audio.close() }
  markAction('Que som gostoso! Quer tentar outro?')
}

function finishGame() {
  if (!selectedGame.value || finishedThisPlay.value) return
  Object.assign(progress, withCompletion(progress, selectedGame.value.id))
  completedThisPlay.value = true
  finishedThisPlay.value = true
  feedback.value = 'Que brincadeira gostosa! Obrigada por explorar no seu tempo. 💗'
  if (session.value && online.value) void syncNow()
}

function toggleFavorite(game: Game) {
  Object.assign(progress, withFavorite(progress, game.id, !progress[String(game.id)]?.favorite))
  if (session.value && online.value) void syncNow()
}

function moveToFavorites() {
  selectedGame.value = null
  favoritesOnly.value = !favoritesOnly.value
  selectedArea.value = 'Todas'
}

async function syncNow() {
  if (!session.value || !navigator.onLine || syncing.value) return
  syncing.value = true
  syncLabel.value = 'Sincronizando…'
  try {
    const remote = await api.getProgress()
    const merged = mergeProgress(progress, remote.progress)
    Object.assign(progress, merged)
    await api.saveProgress(merged)
    syncLabel.value = 'Sincronizado agora'
  } catch (error) {
    syncLabel.value = error instanceof Error && error.message.includes('Failed to fetch') ? 'Sem conexão com a sincronização' : 'Sincronização pendente'
  } finally {
    syncing.value = false
  }
}

async function submitAccess() {
  formError.value = ''
  if (!email.value.trim() || !password.value) {
    formError.value = 'Informe e-mail e senha para continuar.'
    return
  }
  if (loginMode.value !== 'login' && setupToken.value.length < 24) {
    formError.value = 'Use o código de configuração fornecido para a primeira conta adulta.'
    return
  }
  formBusy.value = true
  try {
    if (loginMode.value === 'setup') await api.setup(email.value.trim(), password.value, setupToken.value)
    else if (loginMode.value === 'recover') await api.recover(email.value.trim(), password.value, setupToken.value)
    else await api.login(email.value.trim(), password.value)
    const result = await api.session()
    session.value = result.session
    password.value = ''
    setupToken.value = ''
    await syncNow()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : 'Não foi possível entrar agora.'
  } finally {
    formBusy.value = false
  }
}

async function signOut() {
  try { await api.logout() } catch { /* A sessão local é encerrada mesmo offline. */ }
  session.value = null
  syncLabel.value = 'Salvo neste aparelho'
}

async function openParent() {
  parentOpen.value = true
  formError.value = ''
  try {
    const result = await api.session()
    session.value = result.session
    setupAvailable.value = result.setupAvailable
    loginMode.value = result.setupAvailable ? 'setup' : 'login'
    if (result.session) await syncNow()
  } catch {
    setupAvailable.value = false
  }
}

function handleOnline() { online.value = true; void syncNow() }
function handleOffline() { online.value = false; syncLabel.value = session.value ? 'Sem conexão · alterações ficam neste aparelho' : 'Salvo neste aparelho' }
function handleInstall(event: Event) { event.preventDefault(); installPrompt = event }

async function installApp() {
  if (!installPrompt) return
  const promptEvent = installPrompt as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
  await promptEvent.prompt()
  await promptEvent.userChoice
  installPrompt = null
}

function deleteLocalData() {
  if (!window.confirm('Apagar deste aparelho as brincadeiras concluídas e favoritas?')) return
  clearProgress()
  Object.keys(progress).forEach((key) => delete progress[key])
  syncLabel.value = 'Dados locais apagados'
}

watch(progress, (value) => writeProgress(value), { deep: true })

onMounted(async () => {
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  window.addEventListener('beforeinstallprompt', handleInstall)
  try {
    const result = await api.session()
    session.value = result.session
    setupAvailable.value = result.setupAvailable
    if (session.value) await syncNow()
  } catch { /* O modo de brincadeira continua disponível sem a API. */ }
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
  window.removeEventListener('beforeinstallprompt', handleInstall)
})
</script>

<template>
  <a class="skip-link" href="#conteudo">Pular para as brincadeiras</a>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" aria-label="Voltar ao início" @click="closeGame(); favoritesOnly = false; selectedArea = 'Todas'">
        <img src="/brand/logo-laurinha.png" alt="O Mundo da Laurinha" />
        <span><strong>O Mundo da Laurinha</strong><small>um lugar para descobrir brincando</small></span>
      </button>
      <nav class="top-actions" aria-label="Navegação principal">
        <button class="nav-pill" :class="{ selected: !favoritesOnly && !selectedGame }" @click="selectedGame = null; favoritesOnly = false; selectedArea = 'Todas'">Brincadeiras</button>
        <button class="nav-pill" :class="{ selected: favoritesOnly }" @click="moveToFavorites">♡ Favoritas <span class="nav-count">{{ favoriteCount }}</span></button>
        <button class="adult-button" @click="openParent"><span aria-hidden="true">⌂</span> Responsáveis</button>
      </nav>
    </header>

    <main id="conteudo" class="main-content">
      <template v-if="!selectedGame">
        <section class="hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <span class="eyebrow"><span class="sparkle">✦</span> UM CANTINHO SÓ SEU</span>
            <h1 id="hero-title">Toda descoberta<br /><em>começa brincando.</em></h1>
            <p>Histórias, sons, cores e pequenas aventuras para viver junto — sem pressa, no tempo da Laurinha.</p>
            <a class="hero-link" href="#explorar">Escolher uma brincadeira <span aria-hidden="true">↓</span></a>
            <div class="hero-note"><span class="tiny-heart">♥</span> Feito com carinho para explorar junto.</div>
          </div>
          <div class="hero-art">
            <div class="art-glow"></div>
            <img src="/brand/momentos-laurinha.png" alt="Laurinha brincando, lendo uma história e explorando instrumentos e formas." />
            <div class="floating-note note-one">✨ cada ideia é bem-vinda</div>
            <div class="floating-note note-two">♡ no seu tempo</div>
          </div>
          <div class="hero-bottom"><span>✿</span> Um espaço de afeto, imaginação e descobertas <span>✿</span></div>
        </section>

        <section class="welcome-strip" aria-label="Progresso salvo">
          <div class="welcome-icon">🌷</div>
          <div><strong>Olá, Laurinha!</strong><p>Por onde vamos passear hoje?</p></div>
          <div class="saved-state"><span class="status-dot" :class="{ offline: !online }"></span>{{ online ? 'Brincadeiras salvas neste aparelho' : 'Modo sem internet' }}</div>
        </section>

        <section id="explorar" class="play-section" aria-labelledby="play-title">
          <div class="section-heading">
            <div><span class="eyebrow">ESCOLHA O CAMINHO</span><h2 id="play-title">O que vamos descobrir?</h2><p>Escolha uma brincadeira ou deixe a curiosidade guiar.</p></div>
            <div class="shelf-count"><strong>{{ completedCount }}</strong><span>de {{ games.length }}<br />já exploradas</span></div>
          </div>
          <div class="filters" aria-label="Filtrar brincadeiras">
            <button v-for="area in areas" :key="area" class="filter-chip" :class="{ active: selectedArea === area }" @click="selectedArea = area">{{ area }}</button>
          </div>
          <div v-if="favoritesOnly && visibleGames.length === 0" class="empty-favorites"><span>♡</span><h3>Ainda não temos favoritas</h3><p>Toque no coração de uma brincadeira para guardá-la aqui.</p><button class="text-button" @click="moveToFavorites">Ver todas</button></div>
          <div v-else class="game-grid">
            <article v-for="game in visibleGames" :key="game.id" class="game-card" :style="{ '--card-accent': cardAccent(game.id) }">
              <button class="favorite-toggle" :aria-label="progress[String(game.id)]?.favorite ? `Remover ${game.title} das favoritas` : `Adicionar ${game.title} às favoritas`" :aria-pressed="Boolean(progress[String(game.id)]?.favorite)" @click="toggleFavorite(game)">{{ progress[String(game.id)]?.favorite ? '♥' : '♡' }}</button>
              <button class="game-card-main" @click="openGame(game)">
                <span class="game-illustration" aria-hidden="true">{{ gameEmoji(game.id) }}</span>
                <span class="game-meta"><span class="game-number">BRINCADEIRA {{ String(game.id).padStart(2, '0') }}</span><span class="area-tag">{{ game.area }}</span></span>
                <strong class="game-title">{{ game.title }}</strong>
                <span class="game-short">{{ game.short }}</span>
                <span class="game-card-bottom"><span v-if="progress[String(game.id)]?.completions" class="played-label">✿ Já brincamos</span><span v-else class="played-label new-label">Uma pequena aventura</span><span class="card-arrow" aria-hidden="true">↗</span></span>
              </button>
            </article>
          </div>
          <p class="gentle-reminder"><span>♡</span> Não há certo ou errado. Cada tentativa pode virar uma nova descoberta.</p>
        </section>

        <section class="closing-card">
          <div class="closing-flower">✿</div><div><span class="eyebrow">PEQUENOS MOMENTOS, GRANDES DESCOBERTAS</span><h2>Brincar também é<br /><em>estar junto.</em></h2><p>Um convite para imaginar, conversar e descobrir lado a lado.</p></div>
          <img src="/brand/logo-laurinha.png" alt="" aria-hidden="true" />
        </section>
      </template>

      <section v-else class="activity-page" aria-labelledby="activity-title">
        <button class="back-link" @click="closeGame"><span aria-hidden="true">←</span> Voltar às brincadeiras</button>
        <div class="activity-layout">
          <div class="activity-main">
            <div class="activity-topline"><span class="eyebrow">BRINCADEIRA {{ String(selectedGame.id).padStart(2, '0') }}</span><span class="area-tag">{{ selectedGame.area }}</span></div>
            <h1 id="activity-title">{{ selectedGame.title }}</h1>
            <p class="activity-intro">{{ selectedGame.short }}</p>
            <div class="activity-card">
              <div class="activity-card-top"><span class="activity-kicker">VAMOS EXPLORAR</span><span class="activity-flower">✿</span></div>
              <h2>{{ selectedGame.prompt }}</h2>
              <div v-if="selectedGame.mode === 'sequence'" class="sequence-list" aria-label="Sequência; use os controles para mudar a ordem">
                <div v-for="(item, index) in orderedItems" :key="item" class="sequence-row"><span class="sequence-number">{{ index + 1 }}</span><span>{{ item }}</span><div class="sequence-controls"><button :aria-label="`Mover ${item} para cima`" :disabled="index === 0" @click="reorder(index, -1)">↑</button><button :aria-label="`Mover ${item} para baixo`" :disabled="index === orderedItems.length - 1" @click="reorder(index, 1)">↓</button></div></div>
                <p class="hint">Toque nas setas para inventar uma ordem. Se quiser, deixem como está.</p>
              </div>
              <div v-else-if="selectedGame.mode === 'draw'" class="drawing-area">
                <div class="drawing-tools" aria-label="Escolha uma cor">
                  <button v-for="color in ['#d95a86', '#e9a842', '#8cae7e', '#7893bf', '#9b82b8']" :key="color" class="color-dot" :style="{ background: color }" :aria-label="`Escolher cor ${color}`" :aria-pressed="brushColor === color" @click="brushColor = color"></button>
                  <button class="clear-button" @click="clearCanvas">Apagar traços</button>
                </div>
                <canvas ref="canvas" class="drawing-canvas" width="900" height="430" aria-label="Área para desenhar com o dedo ou mouse" @pointerdown="startDrawing" @pointermove="draw" @pointerup="stopDrawing" @pointercancel="stopDrawing" @pointerleave="stopDrawing"></canvas>
                <p class="hint">Use o dedo, uma caneta ou o mouse. O desenho fica só nesta brincadeira.</p>
              </div>
              <div v-else-if="selectedGame.mode === 'sound'" class="instrument-grid">
                <button class="instrument" @click="playTone(261.63)"><span>🥁</span><strong>Tum</strong><small>tambor suave</small></button>
                <button class="instrument" @click="playTone(329.63)"><span>🔔</span><strong>Plim</strong><small>sino delicado</small></button>
                <button class="instrument" @click="playTone(392)"><span>🎵</span><strong>Dim</strong><small>nota cantada</small></button>
              </div>
              <div v-else-if="selectedGame.mode === 'shapes'" class="shape-play">
                <div class="shape-board" aria-live="polite"><span v-if="shapePieces.length === 0" class="board-placeholder">Sua criação vai aparecer aqui</span><span v-for="(piece, index) in shapePieces" :key="index" class="shape-piece">{{ piece }}</span></div>
                <div class="shape-tools"><button v-for="shape in ['🔺', '🟡', '🟦', '🟩', '💗']" :key="shape" :aria-label="`Adicionar forma ${shape}`" @click="addShape(shape)">{{ shape }}</button><button class="clear-button" @click="shapePieces = []; completedThisPlay = false">Começar de novo</button></div>
              </div>
              <div v-else-if="selectedGame.mode === 'memory'" class="memory-play">
                <div v-if="!memoryStarted" class="memory-preview" aria-label="Sequência para observar"><span v-for="(index, position) in memoryTarget" :key="position">{{ selectedGame.choices?.[index]?.symbol }}</span></div>
                <div v-else class="memory-preview memory-hidden" aria-live="polite">Agora é a sua vez ✨</div>
                <p class="hint">Olhem os bichinhos. Quando estiver pronta, toque em “Minha vez” e tente repetir a sequência.</p>
                <button v-if="!memoryStarted && !completedThisPlay" class="memory-start" @click="startMemory">Minha vez</button>
                <div class="memory-cards"><button v-for="(option, index) in selectedGame.choices" :key="option.label" :class="{ picked: memoryPicks.at(-1) === index }" :disabled="!memoryStarted" @click="chooseMemory(index)"><span>{{ option.symbol }}</span><small>{{ option.label }}</small></button></div>
                <p class="hint">Você já escolheu {{ memoryPicks.length }} de {{ memoryTarget.length }}. Tentem quantas vezes quiserem.</p>
              </div>
              <div v-else-if="selectedGame.mode === 'sort'" class="sorting-play">
                <div class="choice-grid">
                  <button v-for="option in selectedGame.choices" :key="option.label" class="choice-card" :class="{ chosen: selectedItems.includes(option.label) }" :aria-pressed="selectedItems.includes(option.label)" @click="toggleItem(option.label)"><span>{{ option.symbol }}</span><strong>{{ option.label }}</strong></button>
                </div>
                <div class="basket-scene" aria-live="polite"><span class="basket-icon">🧺</span><div><strong>{{ selectedItems.length ? 'Olha o que encontramos!' : 'A cesta está esperando' }}</strong><div class="basket-items"><span v-for="label in selectedItems" :key="label">{{ selectedGame.choices?.find((item) => item.label === label)?.symbol }}</span></div></div></div>
                <p class="hint">{{ selectedGame.id === 15 ? 'Toque nos objetos que podem ser redondinhos. Vamos olhar de pertinho.' : 'Escolham juntos o que colocar na cesta e conversem sobre cada item.' }}</p>
              </div>
              <div v-else-if="selectedGame.mode === 'movement'" class="choice-grid movement-grid">
                <button v-for="(option, index) in selectedGame.choices" :key="option.label" class="choice-card" :class="{ chosen: chosen === index }" :aria-pressed="chosen === index" @click="choose(index)"><span>{{ option.symbol }}</span><strong>{{ option.label }}</strong></button>
              </div>
              <div v-else-if="selectedGame.mode === 'story'" class="choice-grid">
                <button v-for="(option, index) in selectedGame.choices" :key="option.label" class="choice-card" :class="{ chosen: chosen === index }" :aria-pressed="chosen === index" @click="choose(index, `Adorei essa ideia: ${option.label.toLowerCase()}! O que será que acontece depois?`)"><span>{{ option.symbol }}</span><strong>{{ option.label }}</strong></button>
              </div>
              <div v-else-if="selectedGame.choices" class="choice-grid">
                <button v-for="(option, index) in selectedGame.choices" :key="option.label" class="choice-card" :class="{ chosen: chosen === index }" :aria-pressed="chosen === index" @click="choose(index, option.response)"><span>{{ option.symbol }}</span><strong>{{ option.label }}</strong></button>
              </div>
              <p v-if="feedback" class="activity-feedback" role="status">{{ feedback }}</p>
              <p v-else class="gentle-note"><span>♡</span>{{ selectedGame.note }}</p>
              <div class="activity-actions"><button class="primary-button" :disabled="!completedThisPlay || finishedThisPlay" @click="finishGame">{{ finishedThisPlay ? 'Brincadeira guardada' : 'Terminar a brincadeira' }} <span aria-hidden="true">✦</span></button><button class="quiet-button" @click="closeGame">Voltar depois</button></div>
            </div>
            <p class="adult-guidance"><span aria-hidden="true">♡</span> Um adulto pode acompanhar e adaptar a brincadeira ao momento da Laurinha.</p>
          </div>
          <aside class="activity-aside"><div class="aside-art"><img src="/brand/logo-laurinha.png" alt="" aria-hidden="true" /></div><p>Não precisa fazer tudo. Um minutinho de curiosidade já é uma aventura.</p><span class="aside-sparkle">✦ ✦ ✦</span></aside>
        </div>
      </section>
    </main>

    <footer class="footer"><div class="footer-brand"><span>✿</span> O Mundo da Laurinha</div><p>Um espaço para brincar em família · sem anúncios, sem pontuações e sem pressa.</p><button v-if="installPrompt" class="install-button" @click="installApp">Adicionar ao aparelho</button><button class="footer-parent" @click="openParent">Área dos responsáveis</button><p class="footer-credit">Desenvolvido por LMX Soluções Digitais/Segundo Almeida</p></footer>
  </div>

  <div v-if="parentOpen" class="modal-backdrop" @click.self="parentOpen = false">
    <section class="parent-modal" role="dialog" aria-modal="true" aria-labelledby="parent-title">
      <button class="modal-close" aria-label="Fechar área dos responsáveis" @click="parentOpen = false">×</button>
      <template v-if="session">
        <span class="modal-icon">🔐</span><span class="eyebrow">ESPAÇO DA FAMÍLIA</span><h2 id="parent-title">Olá, responsável.</h2><p class="parent-description">Gerencie a sincronização e os dados salvos das brincadeiras.</p>
        <div class="sync-card"><span class="status-dot" :class="{ offline: !online || syncing }"></span><div><strong>{{ syncLabel }}</strong><small>{{ online ? 'Acesso protegido para responsáveis' : 'Quando a internet voltar, você pode sincronizar.' }}</small></div><button :disabled="!online || syncing" @click="syncNow">Sincronizar</button></div>
        <div class="parent-stat"><span>Brincadeiras exploradas</span><strong>{{ completedCount }} / 20</strong></div><div class="parent-stat"><span>Favoritas</span><strong>{{ favoriteCount }}</strong></div>
        <div class="privacy-note"><strong>Privacidade da Laurinha</strong><p>Guardamos apenas quais brincadeiras foram exploradas e as favoritas. Desenhos, respostas e informações pessoais não são enviados.</p></div>
        <div class="parent-actions"><button class="quiet-button" @click="deleteLocalData">Apagar dados deste aparelho</button><button class="text-button" :disabled="!online" @click="signOut">Sair da conta</button></div>
      </template>
      <template v-else>
        <span class="modal-icon">🌷</span><span class="eyebrow">ESPAÇO DA FAMÍLIA</span><h2 id="parent-title">Só para os responsáveis.</h2><p class="parent-description">A brincadeira fica no aparelho. Entre para sincronizar o progresso entre dispositivos.</p>
        <div v-if="setupAvailable && loginMode !== 'recover'" class="mode-switch" role="group" aria-label="Tipo de acesso"><button :class="{ active: loginMode === 'login' }" @click="loginMode = 'login'; formError = ''">Entrar</button><button :class="{ active: loginMode === 'setup' }" @click="loginMode = 'setup'; formError = ''">Criar primeira conta</button></div>
        <div v-if="loginMode === 'recover'" class="mode-switch" role="group" aria-label="Recuperação de acesso"><span>Recuperação protegida da conta</span></div>
        <form class="access-form" @submit.prevent="submitAccess">
          <label>E-mail<input v-model="email" type="email" autocomplete="username" required placeholder="voce@email.com" /></label>
          <label>{{ loginMode === 'login' ? 'Senha-frase' : 'Nova senha-frase' }}<input v-model="password" type="password" :autocomplete="loginMode === 'login' ? 'current-password' : 'new-password'" required minlength="16" placeholder="Pelo menos 16 caracteres" /></label>
          <label v-if="loginMode !== 'login'">Código de configuração<input v-model="setupToken" type="password" autocomplete="off" required minlength="24" placeholder="Código definido no servidor" /></label>
          <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
          <button class="primary-button" :disabled="formBusy">{{ formBusy ? 'Aguarde…' : loginMode === 'setup' ? 'Criar conta protegida' : loginMode === 'recover' ? 'Redefinir senha' : 'Entrar e sincronizar' }}</button>
        </form>
        <button v-if="loginMode === 'login' && !setupAvailable" class="text-button recovery-link" @click="loginMode = 'recover'; formError = ''">Esqueci a senha</button>
        <div class="privacy-note"><strong>Brincar continua disponível.</strong><p>A área infantil funciona sem conta e pode ser usada sem internet. O acesso adulto é necessário apenas para sincronizar em mais de um aparelho.</p></div>
      </template>
    </section>
  </div>
</template>

