import type { TajiduoConfig } from '../../config.ts'
import { loadConfigSafe, saveConfigPartial } from '../../config.ts'
import { buildHeaders, httpGet, generateDs, randomDelay } from '../../http.ts'

const TAJIDUO_DS_SALT = 'pUds3dfMkl'
const TAJIDUO_APP_VERSION = '1.2.2'
const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

const REFRESH_SESSION_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'
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

interface RefreshResponse {
  code: number
  msg: string
  data?: { accessToken?: string; refreshToken?: string }
}

function buildAuthHeaders(config: TajiduoConfig, token: string): Record<string, string> {
  return buildHeaders(DEFAULT_HEADERS, {
    'Authorization': token,
    'uid': config.uid,
    'deviceid': config.deviceId,
    'ds': generateDs(DEFAULT_HEADERS['appversion'] ?? TAJIDUO_APP_VERSION, TAJIDUO_DS_SALT),
  })
}

function isTokenValid(config: TajiduoConfig): boolean {
  if (!config.accessToken || !config.accessTokenExpiresAt) return false
  return Date.now() < config.accessTokenExpiresAt
}

async function refreshAccessToken(config: TajiduoConfig): Promise<{ accessToken: string; refreshToken: string }> {
  const headers = buildHeaders(DEFAULT_HEADERS, {
    'deviceid': config.deviceId,
    'uid': '0',
    'ds': generateDs(DEFAULT_HEADERS['appversion'] ?? TAJIDUO_APP_VERSION, TAJIDUO_DS_SALT),
    'Authorization': config.refreshToken,
  })
  const res = await fetch(REFRESH_SESSION_URL, { method: 'POST', headers })
  if (!res.ok) {
    throw new Error(`[Tajiduo] 刷新 token HTTP ${res.status}`)
  }
  const data = await res.json() as RefreshResponse
  if (data.code !== 0 || !data.data?.accessToken || !data.data?.refreshToken) {
    throw new Error(`[Tajiduo] 刷新 token 失败: ${data.msg}`)
  }
  return { accessToken: data.data.accessToken, refreshToken: data.data.refreshToken }
}

async function ensureAccessToken(config: TajiduoConfig): Promise<string> {
  if (isTokenValid(config)) {
    return config.accessToken!
  }

  console.log('[Tajiduo] accessToken 已过期或不存在，正在刷新...')
  const { accessToken, refreshToken } = await refreshAccessToken(config)

  // Save refreshed tokens to config
  await saveConfigPartial({
    tajiduo: {
      ...config,
      accessToken,
      accessTokenExpiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
      refreshToken,
    },
  })

  // Update in-memory config
  config.accessToken = accessToken
  config.accessTokenExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS
  config.refreshToken = refreshToken

  return accessToken
}

export async function runTajiduo(config: TajiduoConfig): Promise<void> {
  async function withRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    let token = await ensureAccessToken(config)
    try {
      return await fn(token)
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        // Force refresh
        config.accessToken = undefined
        config.accessTokenExpiresAt = undefined
        token = await ensureAccessToken(config)
        try {
          return await fn(token)
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
