import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'

class MemoryStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = [] }
  bind(...params) { this.params = params; return this }

  async first() {
    const sql = this.sql
    const p = this.params
    if (sql.includes('SELECT COUNT(*) AS total FROM account_state')) return { total: this.db.accountId ? 1 : 0 }
    if (sql.includes('FROM sessions JOIN caregivers')) {
      const [tokenHash, now] = p
      const session = this.db.sessions.get(tokenHash)
      const caregiver = session && this.db.caregivers.get(session.caregiverId)
      return caregiver && session.expiresAt > now ? { id: caregiver.id, email: caregiver.email } : null
    }
    if (sql.includes('FROM login_attempts')) return this.db.loginAttempts.get(p[0]) ?? null
    if (sql.includes('FROM caregivers WHERE email')) {
      const caregiver = [...this.db.caregivers.values()].find((row) => row.email.toLowerCase() === String(p[0]).toLowerCase())
      if (!caregiver) return null
      return sql.includes('password_hash') ? { ...caregiver } : { id: caregiver.id }
    }
    if (sql.includes('SELECT 1')) return { '1': 1 }
    throw new Error(`Unsupported first query: ${sql}`)
  }

  async all() {
    if (this.sql.includes('FROM game_progress')) {
      const rows = [...this.db.progress.values()].filter((row) => row.caregiver_id === this.params[0])
      return { results: rows.map((row) => ({ ...row })) }
    }
    throw new Error(`Unsupported all query: ${this.sql}`)
  }

  async run() {
    const sql = this.sql
    const p = this.params
    if (sql.includes('INSERT INTO caregivers')) {
      const [id, email, password_salt, password_hash, created_at] = p
      if ([...this.db.caregivers.values()].some((row) => row.email.toLowerCase() === String(email).toLowerCase())) throw new Error('duplicate email')
      this.db.caregivers.set(id, { id, email, password_salt, password_hash, created_at })
      return { success: true }
    }
    if (sql.includes('INSERT INTO account_state')) {
      if (this.db.accountId) throw new Error('account already exists')
      this.db.accountId = p[1]
      return { success: true }
    }
    if (sql.includes('INSERT INTO sessions')) {
      const [tokenHash, caregiverId, expiresAt, createdAt] = p
      this.db.sessions.set(tokenHash, { caregiverId, expiresAt, createdAt })
      return { success: true }
    }
    if (sql.includes('UPDATE caregivers SET password_salt')) {
      const [salt, hash, id] = p
      const caregiver = this.db.caregivers.get(id)
      Object.assign(caregiver, { password_salt: salt, password_hash: hash })
      return { success: true }
    }
    if (sql.includes('DELETE FROM sessions WHERE caregiver_id')) {
      for (const [hash, session] of this.db.sessions) if (session.caregiverId === p[0]) this.db.sessions.delete(hash)
      return { success: true }
    }
    if (sql.includes('DELETE FROM sessions WHERE token_hash')) {
      this.db.sessions.delete(p[0])
      return { success: true }
    }
    if (sql.includes('DELETE FROM login_attempts')) {
      this.db.loginAttempts.delete(p[0])
      return { success: true }
    }
    if (sql.includes('INSERT INTO login_attempts')) {
      const [email, attempts, windowStartedAt] = p
      this.db.loginAttempts.set(email.toLowerCase(), { attempts, window_started_at: windowStartedAt })
      return { success: true }
    }
    if (sql.includes('INSERT INTO game_progress')) {
      const [caregiverId, gameId, completions, lastPlayed, favorite, favoriteChangedAt] = p
      const key = `${caregiverId}:${gameId}`
      const prior = this.db.progress.get(key)
      const favoriteIsNewer = (favoriteChangedAt ?? '') >= (prior?.favorite_changed_at ?? '')
      this.db.progress.set(key, {
        caregiver_id: caregiverId,
        game_id: gameId,
        completions: Math.max(completions, prior?.completions ?? 0),
        last_played: [lastPlayed, prior?.last_played].filter(Boolean).sort().at(-1) ?? null,
        favorite: favoriteIsNewer ? favorite : prior?.favorite ?? 0,
        favorite_changed_at: favoriteIsNewer ? favoriteChangedAt : prior?.favorite_changed_at ?? null,
      })
      return { success: true }
    }
    throw new Error(`Unsupported run query: ${sql}`)
  }
}

class MemoryD1 {
  accountId = null
  caregivers = new Map()
  sessions = new Map()
  loginAttempts = new Map()
  progress = new Map()
  prepare(sql) { return new MemoryStatement(this, sql) }
  async batch(statements) {
    const snapshot = {
      accountId: this.accountId,
      caregivers: new Map(this.caregivers),
      sessions: new Map(this.sessions),
      loginAttempts: new Map(this.loginAttempts),
      progress: new Map(this.progress),
    }
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    } catch (error) {
      Object.assign(this, snapshot)
      throw error
    }
  }
}

const origin = 'https://family.example'
const setupToken = 'local-test-setup-token-that-is-long-enough'
const env = () => ({
  DB: new MemoryD1(),
  APP_ORIGIN: origin,
  LAURINHA_SETUP_TOKEN: setupToken,
  PASSWORD_PEPPER: 'local-test-password-pepper-long-enough',
})

async function call(env, path, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
  const headers = new Headers()
  if (requestOrigin) headers.set('Origin', requestOrigin)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (cookie) headers.set('Cookie', cookie)
  return worker.fetch(new Request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env)
}

function cookieFrom(response) { return response.headers.get('Set-Cookie')?.split(';', 1)[0] }

test('responsáveis configuram acesso, sincronizam progresso e recuperam a conta', async () => {
  const envState = env()
  let response = await call(envState, '/api/auth/session')
  assert.deepEqual(await response.json(), { session: null, setupAvailable: true })

  response = await call(envState, '/api/auth/setup', {
    method: 'POST', body: { email: 'FAMILIA@example.com', password: 'uma senha-frase segura de teste', setupToken },
  })
  assert.equal(response.status, 201)
  const originalCookie = cookieFrom(response)
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/)
  assert.match(response.headers.get('Set-Cookie'), /SameSite=Lax/)

  response = await call(envState, '/api/auth/session', { cookie: originalCookie })
  assert.deepEqual(await response.json(), { session: { email: 'familia@example.com' }, setupAvailable: false })
  response = await call(envState, '/api/auth/setup', {
    method: 'POST', body: { email: 'outro@example.com', password: 'uma senha-frase segura de teste', setupToken },
  })
  assert.equal(response.status, 409)

  response = await call(envState, '/api/progress', { method: 'PUT', cookie: originalCookie, body: {
    progress: { '1': { completions: 2, lastPlayed: '2026-11-21T12:00:00.000Z', favorite: true, favoriteChangedAt: '2026-11-21T12:01:00.000Z' } },
  } })
  assert.equal(response.status, 200)
  response = await call(envState, '/api/progress', { cookie: originalCookie })
  assert.equal((await response.json()).progress['1'].completions, 2)
  assert.equal((await call(envState, '/api/progress')).status, 401)

  response = await call(envState, '/api/auth/recover', {
    method: 'POST', body: { email: 'familia@example.com', password: 'nova senha-frase segura de teste', setupToken },
  })
  assert.equal(response.status, 200)
  const replacementCookie = cookieFrom(response)
  response = await call(envState, '/api/auth/session', { cookie: originalCookie })
  assert.equal((await response.json()).session, null)
  response = await call(envState, '/api/auth/login', {
    method: 'POST', body: { email: 'familia@example.com', password: 'nova senha-frase segura de teste' },
  })
  assert.equal(response.status, 200)
  assert.ok(cookieFrom(response))
  response = await call(envState, '/api/progress', { cookie: replacementCookie })
  assert.equal((await response.json()).progress['1'].favorite, true)

  response = await call(envState, '/api/auth/login', {
    method: 'POST', requestOrigin: 'https://unexpected.example', body: { email: 'familia@example.com', password: 'nova senha-frase segura de teste' },
  })
  assert.equal(response.status, 403)
})
