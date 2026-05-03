import type { TajiduoConfig } from '../../config.ts'
import { buildHeaders, httpGet, generateDs, randomDelay } from '../../http.ts'
import { TajiduoTokenManager } from './token-manager.ts'

const TAJIDUO_DS_SALT = 'pUds3dfMkl'
const TAJIDUO_APP_VERSION = '1.2.2'

const INIT_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign/rewards'
const SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/sign'
const CHECK_SIGN_IN_URL = 'https://bbs-api.tajiduo.com/apihub/awapi/signin/state'
const GET_GAME_BIND_ROLE_URL = 'https://bbs-api.tajiduo.com/apihub/api/getGameBindRole'

const DEFAULT_HEADERS: Record<string, string> = {
  'accept': 'application/json, text/plain, */*',
  'platform': 'android',
  'appversion': TAJIDUO_APP_VERSION,
  'Host': 'bbs-api.tajiduo.com',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'okhttp/4.12.0',
}

interface SignInState {
  code: number
  msg: string
  ok: boolean
  data: { todaySign: boolean }
}

interface GameBindRoleResponse {
  code: number
  msg: string
  data: {
    account: string
    gameId: number
    gender: number
    lev: number
    roleId: number
    roleName: string
    serverId: number
    serverName: string
  }
}

function buildAuthHeaders(config: TajiduoConfig, token: string): Record<string, string> {
  return buildHeaders(DEFAULT_HEADERS, {
    'Authorization': token,
    'uid': config.uid,
    'deviceid': config.deviceId,
    'ds': generateDs(DEFAULT_HEADERS['appversion'] ?? TAJIDUO_APP_VERSION, TAJIDUO_DS_SALT),
  })
}

export async function runTajiduo(config: TajiduoConfig): Promise<void> {
  const tokenManager = new TajiduoTokenManager()

  // Get or refresh tokens
  let tokens = await tokenManager.getTokens()
  if (!tokens) {
    tokens = await tokenManager.refreshTokens(config.refreshToken, DEFAULT_HEADERS)
    await tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
  }

  async function withRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    try {
      return await fn(tokens!.accessToken)
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        tokens = await tokenManager.refreshTokens(tokens!.refreshToken, DEFAULT_HEADERS)
        await tokenManager.saveTokens(tokens.accessToken, tokens.refreshToken)
        try {
          return await fn(tokens.accessToken)
        } catch (retryErr) {
          if ((retryErr as { status?: number }).status === 401) {
            throw new Error('[Tajiduo] refreshToken 已失效，请重新运行 --setup 登录')
          }
          throw retryErr
        }
      }
      throw err
    }
  }

  // Get bound role
  console.log('[Tajiduo] 获取绑定角色...')
  const roleData = await withRetry(async (token) => {
    return await httpGet<GameBindRoleResponse>(
      GET_GAME_BIND_ROLE_URL,
      { uid: config.uid, gameId: config.gameId },
      buildAuthHeaders(config, token),
    )
  })

  if (roleData.code !== 0 || !roleData.data) {
    throw new Error(`[Tajiduo] 获取绑定角色失败: ${roleData.msg || '未找到绑定角色'}`)
  }

  const roleId = String(roleData.data.roleId)
  console.log(`[Tajiduo] 绑定角色: ${roleData.data.roleName} (ID: ${roleId})`)

  // Init sign-in
  await withRetry(async (token) => {
    return await httpGet(INIT_SIGN_IN_URL, { gameId: config.gameId }, buildAuthHeaders(config, token))
  })

  await randomDelay(300, 1000)

  // Check already signed in
  const signState = await withRetry(async (token) => {
    return await httpGet<SignInState>(
      CHECK_SIGN_IN_URL,
      { gameId: config.gameId },
      buildAuthHeaders(config, token),
    )
  })

  if (signState.data?.todaySign) {
    console.log('[Tajiduo] 今日已签到，跳过')
    return
  }

  // Sign in
  const signResult = await withRetry(async (token) => {
    const res = await fetch(SIGN_IN_URL, {
      method: 'POST',
      headers: { ...buildAuthHeaders(config, token), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ roleId, gameId: config.gameId }),
    })
    if (res.status === 401) {
      const err = new Error('Unauthorized') as Error & { status?: number }
      err.status = 401
      throw err
    }
    return await res.json() as SignInState
  })

  console.log(`[Tajiduo] ${signResult.msg}`)
}
