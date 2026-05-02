import { resolve } from 'path'
import type { CheckInPlatform } from '../../types.ts'


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

export class TajiduoPlatform implements CheckInPlatform {
  readonly name = '塔吉多 (Tajiduo)'

  private get config() {
    const token = process.env['TAJIDUO_TOKEN']
    const roleId = process.env['TAJIDUO_ROLE_ID']
    const gameId = process.env['TAJIDUO_GAME_ID'] ?? '1289'

    if (!token) throw new Error('[Tajiduo] TAJIDUO_TOKEN 未配置')
    if (!roleId) throw new Error('[Tajiduo] TAJIDUO_ROLE_ID 未配置')

    return { token, roleId, gameId }
  }

  isEnabled(): boolean {
    return process.env['TAJIDUO_ENABLED'] === 'true'
  }

  private async buildHeaders(): Promise<Headers> {
    const { token } = this.config
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
    const form = new URLSearchParams({ roleId, gameId })
    return form
  }

  private async initSignIn() {
    const { gameId } = this.config
    await fetch(`${INIT_SIGN_IN_URL}?gameId=${gameId}`, {
      headers: await this.buildHeaders()
    })
  }

  private async checkAlreadySignedIn() {
    const { gameId } = this.config
    const res = await fetch(`${CHECK_SIGN_IN_URL}?gameId=${gameId}`, {
      headers: await this.buildHeaders()
    })
    const data = await res.json() as SignInState
    return data.ok && data.data?.todaySign
  }

  private async signIn(): Promise<void> {
    const headers = await this.buildHeaders()
    const data = await fetch(SIGN_IN_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: this.buildFormData(),
    }).then((res) => res.json()) as SignInState
    console.log(`[Tajiduo] ${data.msg}`)
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
