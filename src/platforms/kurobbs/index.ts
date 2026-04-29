import { resolve } from 'path'
import type { CheckInPlatform } from '../../types.ts'


const INIT_SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/initSignInV2'
const SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/v2'
const RECORD_URL = 'https://api.kurobbs.com/encourage/signIn/queryRecordV2'

interface SignInRecord {
  code: number
  msg: string
  data: { sigInDate: string }[]
}

export class KuroBBSPlatform implements CheckInPlatform {
  readonly name = '库洛社区 (KuroBBS)'

  private get config() {
    const token = process.env['KUROBBS_TOKEN']
    const roleId = process.env['KUROBBS_ROLE_ID']
    const userId = process.env['KUROBBS_USER_ID']
    const gameId = process.env['KUROBBS_GAME_ID'] ?? '3'
    const serverId =
      process.env['KUROBBS_SERVER_ID'] ?? '76402e5b20be2c39f095a152090afddc'
    const ipAddr = process.env['KUROBBS_IP_ADDR']

    if (!token) throw new Error('[KuroBBS] KUROBBS_TOKEN 未配置')
    if (!roleId) throw new Error('[KuroBBS] KUROBBS_ROLE_ID 未配置')
    if (!userId) throw new Error('[KuroBBS] KUROBBS_USER_ID 未配置')

    return { token, roleId, userId, gameId, serverId, ipAddr }
  }

  isEnabled(): boolean {
    return process.env['KUROBBS_ENABLED'] === 'true'
  }

  private async buildHeaders(): Promise<Headers> {
    const { token, ipAddr } = this.config
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

    if (ipAddr) {
      const devCode = headers.get('devCode') ?? ''
      headers.set('devCode', devCode.replace('180.168.255.251', ipAddr))
    }

    headers.set('token', token)
    return headers
  }

  private buildFormData(extra: Record<string, string> = {}): URLSearchParams {
    const { roleId, userId, gameId, serverId } = this.config
    const form = new URLSearchParams({ gameId, serverId, roleId, userId })
    for (const [k, v] of Object.entries(extra)) form.append(k, v)
    return form
  }

  private async request<T>(url: string, body: URLSearchParams): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.buildHeaders(),
      body,
    })
    if (!res.ok) {
      throw new Error(`[KuroBBS] HTTP ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as { code: number; msg: string } & T
    if (data.code !== 200) throw new Error(`[KuroBBS] ${data.msg}`)
    return data
  }

  private async initSignIn(): Promise<void> {
    await this.request(INIT_SIGN_IN_URL, this.buildFormData())
  }

  private async queryRecord(): Promise<SignInRecord['data']> {
    const data = await this.request<SignInRecord>(
      RECORD_URL,
      this.buildFormData(),
    )
    return data.data
  }

  private async signIn(): Promise<void> {
    const reqMonth = (new Date().getMonth() + 1).toString().padStart(2, '0')
    const data = await this.request<{ msg: string }>(
      SIGN_IN_URL,
      this.buildFormData({ reqMonth }),
    )
    console.log(`[KuroBBS] ${data.msg}`)
  }

  async run(): Promise<void> {
    await this.initSignIn()
    await randomDelay(300, 1000)

    const record = await this.queryRecord()
    // yyyy-MM-dd 格式，直接比较字符串前 10 位即可,注意时区是 UTC+8，确保与服务器一致
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    const hasSignedInToday = record.some((r) => r.sigInDate.startsWith(today))

    if (hasSignedInToday) {
      console.log('[KuroBBS] 今日已签到，跳过')
      return
    }

    await randomDelay(300, 1000)
    await this.signIn()
  }
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}
