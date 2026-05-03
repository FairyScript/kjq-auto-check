import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'

const CACHE_DIR = resolve(import.meta.dirname, '../../.cache')
const REFRESH_TOKEN_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'

export interface TokenCache {
  accessToken: string
  refreshToken: string
}

export class TajiduoTokenManager {
  private cachePath: string

  constructor() {
    this.cachePath = resolve(CACHE_DIR, 'tajiduo.json')
  }

  async getTokens(): Promise<TokenCache | null> {
    try {
      const file = Bun.file(this.cachePath)
      if (!(await file.exists())) return null
      const data = await file.json() as TokenCache
      if (!data.accessToken || !data.refreshToken) return null
      return data
    } catch {
      return null
    }
  }

  async saveTokens(accessToken: string, refreshToken: string): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true })
    await Bun.write(this.cachePath, JSON.stringify({ accessToken, refreshToken }, null, 2))
  }

  async refreshTokens(refreshToken: string, baseHeaders: Record<string, string>): Promise<TokenCache> {
    const headers = { ...baseHeaders, Authorization: refreshToken }
    const res = await fetch(REFRESH_TOKEN_URL, { method: 'POST', headers })
    const data = await res.json() as { code: number; msg: string; data: TokenCache }

    if (data.code !== 0) {
      throw new Error(`[Tajiduo] 刷新 token 失败: ${data.msg}`)
    }

    return { accessToken: data.data.accessToken, refreshToken: data.data.refreshToken }
  }
}
