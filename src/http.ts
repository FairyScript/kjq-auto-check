import { createHash } from 'crypto'
import { debugLog } from './debug.ts'

export function buildHeaders(
  base: Record<string, string>,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return { ...base, ...overrides }
}

export async function httpGet<T>(
  url: string,
  query?: Record<string, string>,
  headers?: Record<string, string>,
): Promise<T> {
  const target = query
    ? `${url}?${new URLSearchParams(query)}`
    : url
  const res = await fetch(target, { method: 'GET', headers })
  debugLog(`GET ${target} -> ${res.status}`)
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const data = await res.json() as T
  debugLog('Response:', JSON.stringify(data).slice(0, 500))
  return data
}

export async function httpPost<T>(
  url: string,
  body: Record<string, string>,
  headers?: Record<string, string>,
): Promise<T> {
  debugLog(`POST ${url}`, body)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body),
  })
  debugLog(`POST ${url} -> ${res.status}`)
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const data = await res.json() as T
  debugLog('Response:', JSON.stringify(data).slice(0, 500))
  return data
}

export async function requestWithRetry<T>(
  requestFn: () => Promise<T>,
  onUnauthorized: () => Promise<void>,
): Promise<T> {
  try {
    return await requestFn()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      await onUnauthorized()
      return await requestFn()
    }
    throw err
  }
}

export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function generateDs(appVersion: string, salt: string): string {
  const DS_NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = Array.from({ length: 8 }, () =>
    DS_NONCE_ALPHABET[Math.floor(Math.random() * DS_NONCE_ALPHABET.length)]
  ).join('')
  const raw = `${timestamp}${nonce}${appVersion}${salt}`
  const hash = createHash('md5').update(raw).digest('hex')
  return `${timestamp},${nonce},${hash}`
}
