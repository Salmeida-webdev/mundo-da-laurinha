interface Env {
  DB: D1Database
  APP_ORIGIN?: string
  LAURINHA_SETUP_TOKEN?: string
  PASSWORD_PEPPER?: string
}

interface CaregiverRow { id: string; email: string; password_salt: string; password_hash: string }
interface SessionRow { id: string; email: string }
interface ProgressRow { game_id: number; completions: number; last_played: string | null; favorite: number; favorite_changed_at: string | null }
interface ProgressItem { completions: number; lastPlayed: string | null; favorite: boolean; favoriteChangedAt: string | null }
type ProgressMap = Record<string, ProgressItem>

const SESSION_DAYS = 14
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 8
const MAX_BODY_BYTES = 16_384
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

function response(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...securityHeaders(), ...headers } })
}

function cookieHeader(request: Request, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `laurinha_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

function readCookie(request: Request, key: string) {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${key}=`))
  return match ? decodeURIComponent(match.slice(key.length + 1)) : null
}

function isAllowedOrigin(request: Request, env: Env) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  if (env.APP_ORIGIN && origin === env.APP_ORIGIN) return true
  return DEV_ORIGINS.has(origin)
}

async function readJson<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw new Error('Requisição muito grande.')
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('Requisição muito grande.')
  try { return JSON.parse(text) as T } catch { throw new Error('Formato de solicitação inválido.') }
}

function normalizeEmail(input: unknown) {
  if (typeof input !== 'string') return null
  const email = input.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64url(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

async function hashPassword(password: string, salt: Uint8Array, pepper: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const material = `${base64url(salt)}\u0000${password}`
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(material))
  return base64url(new Uint8Array(signature))
}

async function constantTimeEqual(left: string, right: string) {
  const a = await sha256(left)
  const b = await sha256(right)
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i]
  return difference === 0
}

async function newSession(db: D1Database, caregiverId: string) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = base64url(tokenBytes)
  const tokenHash = base64url(await sha256(token))
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.prepare('INSERT INTO sessions (token_hash, caregiver_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, caregiverId, expires.toISOString(), now.toISOString()).run()
  return { token, expiresAt: expires.toISOString() }
}

async function findSession(request: Request, env: Env): Promise<SessionRow | null> {
  const token = readCookie(request, 'laurinha_session')
  if (!token) return null
  const hash = base64url(await sha256(token))
  return env.DB.prepare(`SELECT caregivers.id, caregivers.email
    FROM sessions JOIN caregivers ON caregivers.id = sessions.caregiver_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1`)
    .bind(hash, new Date().toISOString()).first<SessionRow>()
}

async function requireSession(request: Request, env: Env) {
  const session = await findSession(request, env)
  return session ?? null
}

async function setupAvailable(db: D1Database) {
  const row = await db.prepare('SELECT COUNT(*) AS total FROM account_state').first<{ total: number }>()
  return Number(row?.total ?? 0) === 0
}

async function setup(request: Request, env: Env) {
  if (!isAllowedOrigin(request, env)) return response({ error: 'Origem não autorizada.' }, 403)
  if (!env.LAURINHA_SETUP_TOKEN || !env.PASSWORD_PEPPER) return response({ error: 'A autenticação ainda não foi configurada.' }, 503)
  const input = await readJson<{ email?: unknown; password?: unknown; setupToken?: unknown }>(request)
  const email = normalizeEmail(input.email)
  if (!email || typeof input.password !== 'string' || input.password.length < 16 || input.password.length > 128 || typeof input.setupToken !== 'string') {
    return response({ error: 'Confira o e-mail e use uma senha-frase com pelo menos 16 caracteres.' }, 400)
  }
  if (!await constantTimeEqual(input.setupToken, env.LAURINHA_SETUP_TOKEN)) return response({ error: 'Código de configuração inválido.' }, 403)
  if (!await setupAvailable(env.DB)) return response({ error: 'A primeira conta já foi criada. Entre com o e-mail e a senha cadastrados.' }, 409)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const passwordHash = await hashPassword(input.password, salt, env.PASSWORD_PEPPER)
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO caregivers (id, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, email, base64url(salt), passwordHash, createdAt),
      env.DB.prepare('INSERT INTO account_state (id, caregiver_id, created_at) VALUES (1, ?, ?)').bind(id, createdAt),
    ])
  } catch {
    return response({ error: 'Não foi possível criar a conta. Verifique se já existe uma conta adulta.' }, 409)
  }
  const createdSession = await newSession(env.DB, id)
  return response({ ok: true }, 201, { 'Set-Cookie': cookieHeader(request, createdSession.token, SESSION_DAYS * 24 * 60 * 60) })
}

async function recover(request: Request, env: Env) {
  if (!isAllowedOrigin(request, env)) return response({ error: 'Origem não autorizada.' }, 403)
  if (!env.LAURINHA_SETUP_TOKEN || !env.PASSWORD_PEPPER) return response({ error: 'A autenticação ainda não foi configurada.' }, 503)
  const input = await readJson<{ email?: unknown; password?: unknown; setupToken?: unknown }>(request)
  const email = normalizeEmail(input.email)
  if (!email || typeof input.password !== 'string' || input.password.length < 16 || input.password.length > 128 || typeof input.setupToken !== 'string') {
    return response({ error: 'Confira o e-mail e use uma senha-frase com pelo menos 16 caracteres.' }, 400)
  }
  if (!await constantTimeEqual(input.setupToken, env.LAURINHA_SETUP_TOKEN)) return response({ error: 'Código de configuração inválido.' }, 403)
  const caregiver = await env.DB.prepare('SELECT id FROM caregivers WHERE email = ? LIMIT 1').bind(email).first<{ id: string }>()
  if (!caregiver) return response({ error: 'Não foi possível redefinir o acesso com esses dados.' }, 400)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const passwordHash = await hashPassword(input.password, salt, env.PASSWORD_PEPPER)
  await env.DB.batch([
    env.DB.prepare('UPDATE caregivers SET password_salt = ?, password_hash = ? WHERE id = ?').bind(base64url(salt), passwordHash, caregiver.id),
    env.DB.prepare('DELETE FROM sessions WHERE caregiver_id = ?').bind(caregiver.id),
    env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email),
  ])
  const createdSession = await newSession(env.DB, caregiver.id)
  return response({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, createdSession.token, SESSION_DAYS * 24 * 60 * 60) })
}

async function recordLoginFailure(db: D1Database, email: string) {
  const now = Date.now()
  const row = await db.prepare('SELECT attempts, window_started_at FROM login_attempts WHERE email = ?').bind(email).first<{ attempts: number; window_started_at: number }>()
  const stillInWindow = row && now - Number(row.window_started_at) < LOGIN_WINDOW_MS
  const attempts = stillInWindow ? Number(row.attempts) + 1 : 1
  const windowStart = stillInWindow ? Number(row.window_started_at) : now
  await db.prepare(`INSERT INTO login_attempts (email, attempts, window_started_at) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET attempts = excluded.attempts, window_started_at = excluded.window_started_at`)
    .bind(email, attempts, windowStart).run()
  return attempts
}

async function login(request: Request, env: Env) {
  if (!isAllowedOrigin(request, env)) return response({ error: 'Origem não autorizada.' }, 403)
  if (!env.PASSWORD_PEPPER) return response({ error: 'A autenticação ainda não foi configurada.' }, 503)
  const input = await readJson<{ email?: unknown; password?: unknown }>(request)
  const email = normalizeEmail(input.email)
  if (!email || typeof input.password !== 'string' || input.password.length > 128) return response({ error: 'E-mail ou senha não conferem.' }, 401)
  const attempt = await env.DB.prepare('SELECT attempts, window_started_at FROM login_attempts WHERE email = ?').bind(email).first<{ attempts: number; window_started_at: number }>()
  if (attempt && Date.now() - Number(attempt.window_started_at) < LOGIN_WINDOW_MS && Number(attempt.attempts) >= MAX_LOGIN_ATTEMPTS) {
    return response({ error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.' }, 429, { 'Retry-After': '900' })
  }
  const caregiver = await env.DB.prepare('SELECT id, email, password_salt, password_hash FROM caregivers WHERE email = ? LIMIT 1').bind(email).first<CaregiverRow>()
  const salt = caregiver ? fromBase64url(caregiver.password_salt) : new Uint8Array(16)
  const candidate = await hashPassword(input.password, salt, env.PASSWORD_PEPPER)
  if (!caregiver || !await constantTimeEqual(candidate, caregiver.password_hash)) {
    await recordLoginFailure(env.DB, email)
    return response({ error: 'E-mail ou senha não conferem.' }, 401)
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run()
  const createdSession = await newSession(env.DB, caregiver.id)
  return response({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, createdSession.token, SESSION_DAYS * 24 * 60 * 60) })
}

async function logout(request: Request, env: Env) {
  if (!isAllowedOrigin(request, env)) return response({ error: 'Origem não autorizada.' }, 403)
  const token = readCookie(request, 'laurinha_session')
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(base64url(await sha256(token))).run()
  return response({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) })
}

function mergeProgress(local: ProgressMap, remote: ProgressMap): ProgressMap {
  const result: ProgressMap = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[key]
    const b = remote[key]
    const localFavoriteNewer = (a?.favoriteChangedAt ?? '') >= (b?.favoriteChangedAt ?? '')
    result[key] = {
      completions: Math.max(a?.completions ?? 0, b?.completions ?? 0),
      lastPlayed: [a?.lastPlayed, b?.lastPlayed].filter((item): item is string => Boolean(item)).sort().at(-1) ?? null,
      favorite: localFavoriteNewer ? Boolean(a?.favorite) : Boolean(b?.favorite),
      favoriteChangedAt: localFavoriteNewer ? (a?.favoriteChangedAt ?? null) : (b?.favoriteChangedAt ?? null),
    }
  }
  return result
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 30) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

function validateProgress(value: unknown): ProgressMap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 20) return null
  const clean: ProgressMap = {}
  for (const [key, raw] of entries) {
    if (!/^(?:[1-9]|1\d|20)$/.test(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const item = raw as Record<string, unknown>
    const completions = Number(item.completions)
    if (!Number.isInteger(completions) || completions < 0 || completions > 50_000 || typeof item.favorite !== 'boolean') return null
    const lastPlayed = item.lastPlayed === null ? null : isIsoDate(item.lastPlayed) ? item.lastPlayed : undefined
    const favoriteChangedAt = item.favoriteChangedAt === null ? null : isIsoDate(item.favoriteChangedAt) ? item.favoriteChangedAt : undefined
    if (lastPlayed === undefined || favoriteChangedAt === undefined) return null
    clean[key] = { completions, lastPlayed, favorite: item.favorite, favoriteChangedAt }
  }
  return clean
}

async function getProgress(db: D1Database, caregiverId: string) {
  const result = await db.prepare('SELECT game_id, completions, last_played, favorite, favorite_changed_at FROM game_progress WHERE caregiver_id = ?')
    .bind(caregiverId).all<ProgressRow>()
  return Object.fromEntries((result.results ?? []).map((row) => [String(row.game_id), {
    completions: Number(row.completions), lastPlayed: row.last_played, favorite: Number(row.favorite) === 1, favoriteChangedAt: row.favorite_changed_at,
  }])) as ProgressMap
}

async function putProgress(request: Request, env: Env, caregiverId: string) {
  if (!isAllowedOrigin(request, env)) return response({ error: 'Origem não autorizada.' }, 403)
  const input = await readJson<{ progress?: unknown }>(request)
  const received = validateProgress(input.progress)
  if (!received) return response({ error: 'Dados de progresso inválidos.' }, 400)
  const current = await getProgress(env.DB, caregiverId)
  const merged = mergeProgress(received, current)
  const statements = Object.entries(merged).map(([id, item]) => env.DB.prepare(`INSERT INTO game_progress (caregiver_id, game_id, completions, last_played, favorite, favorite_changed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(caregiver_id, game_id) DO UPDATE SET
      completions = MAX(game_progress.completions, excluded.completions),
      last_played = CASE WHEN COALESCE(excluded.last_played, '') > COALESCE(game_progress.last_played, '') THEN excluded.last_played ELSE game_progress.last_played END,
      favorite = CASE WHEN COALESCE(excluded.favorite_changed_at, '') >= COALESCE(game_progress.favorite_changed_at, '') THEN excluded.favorite ELSE game_progress.favorite END,
      favorite_changed_at = CASE WHEN COALESCE(excluded.favorite_changed_at, '') >= COALESCE(game_progress.favorite_changed_at, '') THEN excluded.favorite_changed_at ELSE game_progress.favorite_changed_at END`)
    .bind(caregiverId, Number(id), item.completions, item.lastPlayed, Number(item.favorite), item.favoriteChangedAt))
  if (statements.length) await env.DB.batch(statements)
  return response({ ok: true })
}

function securityHeaders() {
  return {
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return response({ error: 'Método não permitido.' }, 405, securityHeaders())
    if (url.pathname === '/api/health' && request.method === 'GET') {
      try { await env.DB.prepare('SELECT 1').first(); return response({ ok: true }, 200, securityHeaders()) }
      catch { return response({ ok: false }, 503, securityHeaders()) }
    }
    try {
      if (url.pathname === '/api/auth/session' && request.method === 'GET') {
        const user = await findSession(request, env)
        return response({ session: user ? { email: user.email } : null, setupAvailable: await setupAvailable(env.DB) && Boolean(env.LAURINHA_SETUP_TOKEN) && Boolean(env.PASSWORD_PEPPER) }, 200, securityHeaders())
      }
      if (url.pathname === '/api/auth/setup' && request.method === 'POST') return await setup(request, env)
      if (url.pathname === '/api/auth/recover' && request.method === 'POST') return await recover(request, env)
      if (url.pathname === '/api/auth/login' && request.method === 'POST') return await login(request, env)
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return await logout(request, env)
      if (url.pathname === '/api/progress' && request.method === 'GET') {
        const user = await requireSession(request, env)
        return user ? response({ progress: await getProgress(env.DB, user.id) }, 200, securityHeaders()) : response({ error: 'Entre na área dos responsáveis.' }, 401, securityHeaders())
      }
      if (url.pathname === '/api/progress' && request.method === 'PUT') {
        const user = await requireSession(request, env)
        return user ? await putProgress(request, env, user.id) : response({ error: 'Entre na área dos responsáveis.' }, 401, securityHeaders())
      }
      return response({ error: 'Rota não encontrada.' }, 404, securityHeaders())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
      const safe = message === 'Requisição muito grande.' || message === 'Formato de solicitação inválido.' ? message : 'Não foi possível concluir agora.'
      return response({ error: safe }, safe === message ? 400 : 500, securityHeaders())
    }
  },
}
