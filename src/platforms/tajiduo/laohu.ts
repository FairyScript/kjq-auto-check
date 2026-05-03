import { createCipheriv, createHash, randomUUID } from 'crypto'

const LAOHU_BASE_URL = 'https://user.laohu.com'
const LAOHU_SDK_VERSION = '4.273.0'
const LAOHU_USER_AGENT = 'okhttp/4.9.0'
const LAOHU_DEFAULT_PACKAGE = 'com.pwrd.htassistant'
const LAOHU_DEFAULT_VERSION_CODE = 12

const LAOHU_APP_ID = 10550
const LAOHU_APP_KEY = '89155cc4e8634ec5b1b6364013b23e3e'

export interface LaohuAccount {
  userId: number
  token: string
}

interface LaohuDevice {
  deviceId: string
  deviceType: string
  deviceModel: string
  deviceName: string
  deviceSys: string
  adm: string
  imei: string
  idfa: string
  mac: string
}

function createDevice(): LaohuDevice {
  const deviceId = 'HT' + randomUUID().replace(/-/g, '').slice(0, 14).toUpperCase()
  return {
    deviceId,
    deviceType: 'Pixel 6',
    deviceModel: 'Pixel 6',
    deviceName: 'Pixel 6',
    deviceSys: 'Android 14',
    adm: deviceId,
    imei: '',
    idfa: '',
    mac: '',
  }
}

function aesEncrypt(plain: string, appKey: string): string {
  const key = Buffer.from(appKey.slice(-16))
  const cipher = createCipheriv('aes-128-ecb', key, null)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return encrypted.toString('base64')
}

function signParams(params: Record<string, string>, appKey: string): string {
  const raw = Object.keys(params).sort().map((k) => params[k]).join('') + appKey
  return createHash('md5').update(raw).digest('hex')
}

function commonFields(device: LaohuDevice, useMillis: boolean): Record<string, string> {
  const ts = useMillis
    ? String(Date.now())
    : String(Math.floor(Date.now() / 1000))

  const base: Record<string, string> = {
    appId: String(LAOHU_APP_ID),
    channelId: '1',
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    deviceModel: device.deviceModel,
    deviceName: device.deviceName,
    deviceSys: device.deviceSys,
    adm: device.adm,
    idfa: device.idfa,
    sdkVersion: LAOHU_SDK_VERSION,
    bid: LAOHU_DEFAULT_PACKAGE,
    t: ts,
  }

  if (useMillis) {
    base['version'] = String(LAOHU_DEFAULT_VERSION_CODE)
    base['mac'] = device.mac
  } else {
    base['versionCode'] = String(LAOHU_DEFAULT_VERSION_CODE)
    base['imei'] = device.imei
  }

  return base
}

async function submit<T>(
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' = 'POST',
  keepEmpty = false,
): Promise<T> {
  const signed = { ...params, sign: signParams(params, LAOHU_APP_KEY) }
  const cleaned = keepEmpty
    ? signed
    : Object.fromEntries(Object.entries(signed).filter(([, v]) => v !== ''))

  const url = `${LAOHU_BASE_URL}${path}`
  const options: RequestInit = {
    method,
    headers: { 'User-Agent': LAOHU_USER_AGENT },
  }

  if (method === 'GET') {
    const qs = new URLSearchParams(cleaned).toString()
    const res = await fetch(`${url}?${qs}`, options)
    const payload = await res.json() as { code: number | string; message?: string; result?: T }
    if (payload.code !== 0 && payload.code !== '0') {
      throw new Error(`[Laohu] ${payload.message ?? '请求失败'}`)
    }
    return (payload.result ?? {}) as T
  } else {
    options.headers = { ...options.headers as Record<string, string>, 'Content-Type': 'application/x-www-form-urlencoded' }
    options.body = new URLSearchParams(cleaned)
    const res = await fetch(url, options)
    const payload = await res.json() as { code: number | string; message?: string; result?: T }
    if (payload.code !== 0 && payload.code !== '0') {
      throw new Error(`[Laohu] ${payload.message ?? '请求失败'}`)
    }
    return (payload.result ?? {}) as T
  }
}

export async function sendSmsCode(cellphone: string): Promise<void> {
  const device = createDevice()
  const params = commonFields(device, false)
  params['cellphone'] = cellphone
  params['areaCodeId'] = '1'
  params['type'] = '16'
  await submit('/m/newApi/sendPhoneCaptchaWithOutLogin', params)
}

export async function loginBySMS(cellphone: string, code: string): Promise<LaohuAccount> {
  const device = createDevice()
  const params = commonFields(device, true)
  params['cellphone'] = aesEncrypt(cellphone, LAOHU_APP_KEY)
  params['captcha'] = aesEncrypt(code, LAOHU_APP_KEY)
  params['areaCodeId'] = '1'
  params['type'] = '16'

  const result = await submit<{ userId?: number | string; token?: string }>(
    '/openApi/sms/new/login',
    params,
    'POST',
    true,
  )

  if (result.userId === undefined || result.token === undefined) {
    throw new Error('[Laohu] 登录返回缺少 userId/token')
  }

  const userId = Number(result.userId)
  if (isNaN(userId) || userId <= 0) {
    throw new Error('[Laohu] 登录返回 userId 无效')
  }

  return { userId, token: String(result.token) }
}
