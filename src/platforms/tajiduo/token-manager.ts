import { TokenManager } from '../../token-manager.ts'
import type { TokenCache } from '../../token-manager.ts'

const REFRESH_TOKEN_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'

export class TajiduoTokenManager extends TokenManager {
  constructor() {
    super('tajiduo')
  }

  async refreshTokens(refreshToken: string): Promise<TokenCache> {
    const res = await fetch(REFRESH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': refreshToken
      }
    })
    const data = await res.json() as { code: number; msg: string; data: TokenCache }

    if (data.code !== 0) {
      throw new Error(`[Tajiduo] 刷新 token 失败: ${data.msg}`)
    }

    return {
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken
    }
  }
}
