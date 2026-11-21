import type { ProgressMap } from './progress'

export interface AdultSession { email: string }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  })
  const body = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir agora. Tente novamente.')
  return body
}

export const api = {
  setup: (email: string, password: string, setupToken: string) => request<{ ok: true }>('/auth/setup', { method: 'POST', body: JSON.stringify({ email, password, setupToken }) }),
  recover: (email: string, password: string, setupToken: string) => request<{ ok: true }>('/auth/recover', { method: 'POST', body: JSON.stringify({ email, password, setupToken }) }),
  login: (email: string, password: string) => request<{ ok: true }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST', body: '{}' }),
  session: () => request<{ session: AdultSession | null; setupAvailable: boolean }>('/auth/session'),
  getProgress: () => request<{ progress: ProgressMap }>('/progress'),
  saveProgress: (progress: ProgressMap) => request<{ ok: true }>('/progress', { method: 'PUT', body: JSON.stringify({ progress }) }),
}
