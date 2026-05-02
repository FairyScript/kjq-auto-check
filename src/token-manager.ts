import { mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'

const CACHE_DIR = resolve(import.meta.dirname, '../.cache')

export interface TokenCache {
  accessToken: string
  refreshToken: string
}

export abstract class TokenManager {
  private cachePath: string

  constructor(platformName: string) {
    this.cachePath = resolve(CACHE_DIR, `${platformName}.json`)
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

  abstract refreshTokens(refreshToken: string, headers?: Headers): Promise<TokenCache>
}
