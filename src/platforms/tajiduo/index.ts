import { resolve } from 'path'
import type { CheckInPlatform } from '../../types.ts'
import { TajiduoTokenManager } from './token-manager.ts'

const INIT_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign/rewards'
const SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign'
const CHECK_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/signin/state'

interface SignInState {
  code: number
  msg: string
  ok: boolean
  data: {
    todaySign: boolean
  }
}

interface TokenRefreshError extends Error {
  status?: number
}

export class TajiduoPlatform implements CheckInPlatform {
  readonly name = '塔吉多 (Tajiduo)'
  private tokenManager = new TajiduoTokenManager()

  private get config() {
    const refreshToken = process.env['TAJIDUO_REFRESH_TOKEN']
    const roleId = process.env['TAJIDUO_ROLE_ID']
    const gameId = process.env['TAJIDUO_GAME_ID'] ?? '1289'

    if (!refreshToken) throw new Error('[Tajiduo] TAJIDUO_REFRESH_TOKEN 未配置')
    if (!roleId) throw new Error('[Tajiduo] TAJIDUO_ROLE_ID 未配置')

    return { refreshToken, roleId, gameId }
  }

  isEnabled(): boolean {
    return process.env['TAJIDUO_ENABLED'] === 'true'
  }

  private async buildHeaders(token: string): Promise<Headers> {
    const rawHeaders = await Bun.file(resolve(import.meta.dirname, 'headers.txt')).text()
    const DEFAULT_HEADERS = Object.fromEntries(
      rawHeaders
        .split('\n')
        .filter((line) => line.includes(':'))
        .map((line) => {
          const [k, v] = line.split(':', 2)
          return [k!.trim(), v!.trim()]
        }),
    )

    const headers = new Headers(DEFAULT_HEADERS)
    headers.set('Authorization', token)
    return headers
  }

  private buildFormData(): URLSearchParams {
    const { roleId, gameId } = this.config
    return new URLSearchParams({ roleId, gameId })
  }

  private async requestWithRetry<T>(requestFn: (token: string) => Promise<T>): Promise<T> {
    let tokens = await this.tokenManager.getTokens()

    if (!tokens) {
      tokens = await this.tokenManager.refreshTokens(this.config.refreshToken)
      await this.tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
    }

    try {
      return await requestFn(tokens.accessToken)
    } catch (err) {
      const tokenErr = err as TokenRefreshError
      if (tokenErr.status === 401) {
        const newTokens = await this.tokenManager.refreshTokens(tokens.refreshToken)
        await this.tokenManager.saveTokens(newTokens.accessToken, newTokens.refreshToken)

        try {
          return await requestFn(newTokens.accessToken)
        } catch (retryErr) {
          const retryTokenErr = retryErr as TokenRefreshError
          if (retryTokenErr.status === 401) {
            throw new Error('[Tajiduo] refreshToken 已失效，请重新登录获取')
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  private async initSignIn() {
    const { gameId } = this.config
    await this.requestWithRetry(async (token) => {
      const res = await fetch(`${INIT_SIGN_IN_URL}?gameId=${gameId}`, {
        headers: await this.buildHeaders(token)
      })
      if (res.status === 401) {
        const err = new Error('Unauthorized') as TokenRefreshError
        err.status = 401
        throw err
      }
    })
  }

  private async checkAlreadySignedIn() {
    const { gameId } = this.config
    return await this.requestWithRetry(async (token) => {
      const res = await fetch(`${CHECK_SIGN_IN_URL}?gameId=${gameId}`, {
        headers: await this.buildHeaders(token)
      })
      if (res.status === 401) {
        const err = new Error('Unauthorized') as TokenRefreshError
        err.status = 401
        throw err
      }
      const data = await res.json() as SignInState
      return data && data.data?.todaySign
    })
  }

  private async signIn(): Promise<void> {
    await this.requestWithRetry(async (token) => {
      const res = await fetch(SIGN_IN_URL, {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders(token)),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: this.buildFormData(),
      })
      if (res.status === 401) {
        const err = new Error('Unauthorized') as TokenRefreshError
        err.status = 401
        throw err
      }
      const data = await res.json() as SignInState
      console.log(`[Tajiduo] ${data.msg}`)
    })
  }

  async run(): Promise<void> {
    await this.initSignIn()
    await randomDelay(300, 1000)

    const alreadySignedIn = await this.checkAlreadySignedIn()
    if (alreadySignedIn) {
      console.log(`[Tajiduo] 今日已签到，跳过`)
      return
    }

    await this.signIn()
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}
