import { createInterface } from 'readline'
import { randomUUID } from 'crypto'
import type { TajiduoConfig } from '../../config.ts'
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
  const headers = { ...TAJIDUO_BASE_HEADERS, deviceid: deviceId, uid: '0' }
  const res = await fetch(USER_CENTER_LOGIN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: laohuToken,
      userIdentity: String(laohuUserId),
      appId: TAJIDUO_USER_CENTER_APP_ID,
    }),
  })
  const data = await res.json() as { code: number; msg: string; data?: { accessToken?: string; refreshToken?: string; uid?: string | number } }

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
  const headers = { ...TAJIDUO_BASE_HEADERS, deviceid: deviceId, uid: '0', Authorization: refreshToken }
  const res = await fetch(REFRESH_SESSION_URL, { method: 'POST', headers })
  const data = await res.json() as { code: number; msg: string; data?: { accessToken?: string; refreshToken?: string } }

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
  const headers = {
    ...TAJIDUO_BASE_HEADERS,
    deviceid: deviceId,
    uid,
    Authorization: accessToken,
  }
  const url = `${GET_BIND_ROLE_URL}?uid=${uid}&gameId=${gameId}`
  const res = await fetch(url, { method: 'GET', headers })
  const data = await res.json() as { code: number; msg: string; data?: { roleId?: number; roleName?: string } }

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
  console.log('将通过手机短信验证码登录:\n')

  const gameId = await prompt(rl, 'Game ID (可选, 默认 1289): ') || '1289'

  // Generate deviceId
  const deviceId = 'HT' + randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()
  console.log(`\n设备 ID: ${deviceId}`)

  // SMS login
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

  // Refresh to get a stable token pair
  console.log('正在获取稳定的 refreshToken...')
  const refreshed = await refreshSession(session.refreshToken, deviceId)

  // Get bind role for display
  console.log('正在获取绑定角色...')
  const role = await getBindRole(session.accessToken, session.uid, gameId, deviceId)
  console.log(`绑定角色: ${role.roleName} (ID: ${role.roleId})`)

  rl.close()

  return {
    enabled: true,
    deviceId,
    uid: session.uid,
    refreshToken: refreshed.refreshToken,
    gameId,
  }
}
