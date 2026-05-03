import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import type { TajiduoConfig } from '../../config.ts'
import { loadConfigSafe, saveConfigPartial } from '../../config.ts'
import { generateDs } from '../../http.ts'
import { debugLog } from '../../debug.ts'
import { sendSmsCode, loginBySMS } from './laohu.ts'

const USER_CENTER_LOGIN_URL = 'https://bbs-api.tajiduo.com/usercenter/api/login'
const REFRESH_SESSION_URL = 'https://bbs-api.tajiduo.com/usercenter/api/refreshToken'
const GET_BIND_ROLE_URL = 'https://bbs-api.tajiduo.com/apihub/api/getGameBindRole'

const TAJIDUO_BASE_HEADERS: Record<string, string> = {
  'accept': 'application/json, text/plain, */*',
  'platform': 'android',
  'appversion': '1.2.2',
  'Host': 'bbs-api.tajiduo.com',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'User-Agent': 'okhttp/4.12.0',
}

const TAJIDUO_USER_CENTER_APP_ID = '10551'
const TAJIDUO_DS_SALT = 'pUds3dfMkl'

async function parseResponse<T extends { code: number; msg: string }>(res: Response, label: string): Promise<T> {
  debugLog(`[Tajiduo] ${label} -> HTTP ${res.status}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[Tajiduo] ${label} HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json() as T | null
  if (!data || typeof data.code !== 'number') {
    throw new Error(`[Tajiduo] ${label} 返回格式异常: ${JSON.stringify(data).slice(0, 200)}`)
  }
  debugLog(`[Tajiduo] ${label} code=${data.code} msg=${data.msg}`)
  return data
}

function buildApiHeaders(deviceId: string, extra?: Record<string, string>): Record<string, string> {
  return {
    ...TAJIDUO_BASE_HEADERS,
    deviceid: deviceId,
    uid: '0',
    ds: generateDs(TAJIDUO_BASE_HEADERS['appversion'], TAJIDUO_DS_SALT),
    ...extra,
  }
}

interface TajiduoSession {
  accessToken: string
  refreshToken: string
  uid: string
}

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

async function userCenterLogin(laohuToken: string, laohuUserId: number, deviceId: string): Promise<TajiduoSession> {
  const headers = buildApiHeaders(deviceId)
  const res = await fetch(USER_CENTER_LOGIN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: laohuToken,
      userIdentity: String(laohuUserId),
      appId: TAJIDUO_USER_CENTER_APP_ID,
    }),
  })
  const data = await parseResponse<{ code: number; msg: string; data?: { accessToken?: string; refreshToken?: string; uid?: string | number } }>(res, 'POST /usercenter/api/login')

  if (data.code !== 0 || !data.data) {
    throw new Error(`[Tajiduo] 用户中心登录失败: ${data.msg}`)
  }

  const accessToken = data.data.accessToken
  const refreshToken = data.data.refreshToken
  const uid = data.data.uid !== undefined ? String(data.data.uid) : undefined

  if (!accessToken || !refreshToken || !uid) {
    throw new Error('[Tajiduo] 登录返回缺少 accessToken/refreshToken/uid')
  }

  return { accessToken, refreshToken, uid }
}

async function refreshSession(refreshToken: string, deviceId: string): Promise<TajiduoSession> {
  const headers = buildApiHeaders(deviceId, { Authorization: refreshToken })
  const res = await fetch(REFRESH_SESSION_URL, { method: 'POST', headers })
  const data = await parseResponse<{ code: number; msg: string; data?: { accessToken?: string; refreshToken?: string } }>(res, 'POST /refreshToken')

  if (data.code !== 0 || !data.data) {
    throw new Error(`[Tajiduo] 刷新 session 失败: ${data.msg}`)
  }

  const accessToken = data.data.accessToken
  const newRefresh = data.data.refreshToken

  if (!accessToken || !newRefresh) {
    throw new Error('[Tajiduo] 刷新返回缺少 accessToken/refreshToken')
  }

  return { accessToken, refreshToken: newRefresh, uid: '' }
}

async function getBindRole(accessToken: string, uid: string, gameId: string, deviceId: string): Promise<{ roleId: string; roleName: string }> {
  const headers = buildApiHeaders(deviceId, { uid, Authorization: accessToken })
  const url = `${GET_BIND_ROLE_URL}?uid=${uid}&gameId=${gameId}`
  const res = await fetch(url, { method: 'GET', headers })
  const data = await parseResponse<{ code: number; msg: string; data?: { roleId?: number; roleName?: string } }>(res, 'GET /getGameBindRole')

  if (data.code !== 0 || !data.data) {
    throw new Error(`[Tajiduo] 获取绑定角色失败: ${data.msg}`)
  }

  return {
    roleId: String(data.data.roleId ?? 0),
    roleName: data.data.roleName ?? '未知',
  }
}

export async function setupTajiduo(): Promise<TajiduoConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })

  console.log('\n--- 塔吉多 (Tajiduo) 配置 ---')

  // Load existing config to reuse deviceId and other values
  const existing = await loadConfigSafe()
  const existingCfg = existing.tajiduo

  const gameId = existingCfg?.gameId || await prompt(rl, 'Game ID (可选, 默认 1289): ') || '1289'

  // Reuse deviceId if present, otherwise generate and save immediately
  let deviceId = existingCfg?.deviceId
  if (deviceId) {
    console.log(`\n复用已有设备 ID: ${deviceId}`)
  } else {
    deviceId = 'HT' + randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()
    console.log(`\n新建设备 ID: ${deviceId}`)
    await saveConfigPartial({ tajiduo: { enabled: true, deviceId, uid: '', refreshToken: '', gameId } })
    console.log('(设备 ID 已保存)')
  }

  // Check if we already have valid tokens
  if (existingCfg?.refreshToken && existingCfg?.uid) {
    console.log('\n检测到已有登录状态，尝试复用...')
    try {
      const refreshed = await refreshSession(existingCfg.refreshToken, deviceId)
      console.log(`Token 刷新成功，uid=${existingCfg.uid}`)
      await saveConfigPartial({ tajiduo: { enabled: true, deviceId, uid: existingCfg.uid, refreshToken: refreshed.refreshToken, gameId } })

      const role = await getBindRole(refreshed.accessToken, existingCfg.uid, gameId, deviceId)
      console.log(`绑定角色: ${role.roleName} (ID: ${role.roleId})`)

      rl.close()
      return { enabled: true, deviceId, uid: existingCfg.uid, refreshToken: refreshed.refreshToken, gameId }
    } catch {
      console.log('已有 token 已失效，需要重新登录')
    }
  }

  // SMS login flow
  console.log('\n将通过手机短信验证码登录:')

  const cellphone = await prompt(rl, '\n手机号码: ')
  if (!cellphone) throw new Error('手机号码不能为空')

  console.log('正在发送验证码...')
  await sendSmsCode(cellphone)
  console.log('验证码已发送!')

  const smsCode = await prompt(rl, '请输入验证码: ')
  if (!smsCode) throw new Error('验证码不能为空')

  console.log('正在登录老虎账号...')
  const laohuAccount = await loginBySMS(cellphone, smsCode)
  console.log(`老虎登录成功: userId=${laohuAccount.userId}`)

  console.log('正在登录塔吉多用户中心...')
  const session = await userCenterLogin(laohuAccount.token, laohuAccount.userId, deviceId)
  console.log(`塔吉多登录成功: uid=${session.uid}`)

  // Save immediately after successful user center login
  await saveConfigPartial({ tajiduo: { enabled: true, deviceId, uid: session.uid, refreshToken: session.refreshToken, gameId } })
  console.log('(登录状态已保存)')

  // Refresh to get a stable token pair
  console.log('正在获取稳定的 refreshToken...')
  const refreshed = await refreshSession(session.refreshToken, deviceId)

  // Save again with stable refreshToken
  await saveConfigPartial({ tajiduo: { enabled: true, deviceId, uid: session.uid, refreshToken: refreshed.refreshToken, gameId } })
  console.log('(稳定 token 已保存)')

  // Get bind role for display
  console.log('正在获取绑定角色...')
  const role = await getBindRole(session.accessToken, session.uid, gameId, deviceId)
  console.log(`绑定角色: ${role.roleName} (ID: ${role.roleId})`)

  rl.close()

  return { enabled: true, deviceId, uid: session.uid, refreshToken: refreshed.refreshToken, gameId }
}
