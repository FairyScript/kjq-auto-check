import type { KuroBBSConfig } from '../../config.ts'
import { buildHeaders, httpPost, randomDelay } from '../../http.ts'

const INIT_SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/initSignInV2'
const SIGN_IN_URL = 'https://api.kurobbs.com/encourage/signIn/v2'
const RECORD_URL = 'https://api.kurobbs.com/encourage/signIn/queryRecordV2'

const DEFAULT_HEADERS: Record<string, string> = {
  'Host': 'api.kurobbs.com',
  'Connection': 'keep-alive',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache',
  'sec-ch-ua-platform': '"Android"',
  'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Android WebView";v="146"',
  'devCode': '180.168.255.251, Mozilla/5.0 (Linux; Android 15; 22081212C Build/AQ3A.250226.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/146.0.7680.119 Mobile Safari/537.36 Kuro/3.0.0 KuroGameBox/3.0.0',
  'sec-ch-ua-mobile': '?1',
  'source': 'android',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 15; 22081212C Build/AQ3A.250226.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/146.0.7680.119 Mobile Safari/537.36 Kuro/3.0.0 KuroGameBox/3.0.0',
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Origin': 'https://web-static.kurobbs.com',
  'X-Requested-With': 'com.kurogame.kjq',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
}

interface SignInRecord {
  code: number
  msg: string
  data: { sigInDate: string }[]
}

function buildRequestHeaders(config: KuroBBSConfig): Record<string, string> {
  const headers = buildHeaders(DEFAULT_HEADERS, { token: config.token })
  if (config.ipAddr) {
    headers['devCode'] = headers['devCode'].replace('180.168.255.251', config.ipAddr)
  }
  return headers
}

function buildFormData(config: KuroBBSConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    gameId: config.gameId,
    serverId: config.serverId,
    roleId: config.roleId,
    userId: config.userId,
    ...extra,
  }
}

export async function runKuroBBS(config: KuroBBSConfig): Promise<void> {
  const headers = buildRequestHeaders(config)

  await httpPost(INIT_SIGN_IN_URL, buildFormData(config), headers)
  await randomDelay(300, 1000)

  const record = await httpPost<SignInRecord>(RECORD_URL, buildFormData(config), headers)
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const hasSignedInToday = record.data.some((r) => r.sigInDate.startsWith(today))

  if (hasSignedInToday) {
    console.log('[KuroBBS] 今日已签到，跳过')
    return
  }

  await randomDelay(300, 1000)

  const reqMonth = (new Date().getMonth() + 1).toString().padStart(2, '0')
  const result = await httpPost<{ msg: string }>(SIGN_IN_URL, buildFormData(config, { reqMonth }), headers)
  console.log(`[KuroBBS] ${result.msg}`)
}
