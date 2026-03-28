import { fetch, file } from 'bun'

const initSignInUrl = 'https://api.kurobbs.com/encourage/signIn/initSignInV2'
const signInUrl = 'https://api.kurobbs.com/encourage/signIn/v2'
const recordUrl = 'https://api.kurobbs.com/encourage/signIn/queryRecordV2'
const gameId = '3'
const serverId = '76402e5b20be2c39f095a152090afddc'

/** 初始化签到 */
async function initSignin() {
  const { roleId, userId } = getUserInfo()

  const formData = new URLSearchParams()
  formData.append('gameId', gameId)
  formData.append('serverId', serverId)
  formData.append('roleId', roleId)
  formData.append('userId', userId)

  const res = await fetch(initSignInUrl, {
    method: 'POST',
    headers: await getHeaders(),
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`Failed to init sign in: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as any
  if (data.code !== 200) {
    throw new Error(data.msg)
  }
  return true
}

/** 查询签到记录 */
async function queryRecord() {
  const { roleId, userId } = getUserInfo()
  const formData = new URLSearchParams()
  formData.append('gameId', gameId)
  formData.append('serverId', serverId)
  formData.append('roleId', roleId)
  formData.append('userId', userId)

  const res = await fetch(recordUrl, {
    method: 'POST',
    headers: await getHeaders(),
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`Failed to query record: ${res.status} ${res.statusText}`)
  }

  interface SignInRecord {
    code: number
    msg: string
    data: {
      sigInDate: string //"2026-03-24 00:56:31"
    }[]
  }

  const data = (await res.json()) as SignInRecord
  if (data.code !== 200) {
    throw new Error(data.msg)
  }

  return data.data
}

/** 执行签到 */
async function signIn() {
  const { roleId, userId } = getUserInfo()

  const formData = new URLSearchParams()
  formData.append('gameId', gameId)
  formData.append('serverId', serverId)
  formData.append('roleId', roleId)
  formData.append('userId', userId)
  formData.append(
    'reqMonth',
    (new Date().getMonth() + 1).toString().padStart(2, '0'),
  )

  const res = await fetch(signInUrl, {
    method: 'POST',
    headers: await getHeaders(),
    body: formData,
  })

  if (!res.ok) {
    throw new Error(`Failed to sign in: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as any
  if (data.code !== 200) {
    throw new Error(data.msg)
  }
  console.log(data.msg)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function randomDelay(min: number, max: number) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min
  await sleep(delay)
}

function getUserInfo() {
  const roleId = process.env.roleId
  const userId = process.env.userId
  if (!roleId || !userId) {
    throw new Error('roleId and userId must be set in environment variables')
  }
  return { roleId, userId }
}

let cachedHeaders: Headers | null = null
/** 获取请求头 */
async function getHeaders() {
  if (cachedHeaders) return cachedHeaders

  const raw = await file('./headers.txt').text()
  const headers = new Headers()
  raw.split('\n').forEach((line) => {
    if (!line || !line.includes(':')) return
    const index = line.indexOf(':')
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key && value) {
      headers.set(key, value)
    }
  })
  // get token from env file
  const token = process.env.token
  if (!token) {
    throw new Error('TOKEN is not set in environment variables')
  }
  headers.set('token', token)

  // handle ip address
  const ipAddr = process.env.ipAddr
  if (ipAddr) {
    const devCode = headers.get('devCode') || ''
    const newDevCode = devCode.replace('180.168.255.251', ipAddr)
    headers.set('devCode', newDevCode)
  }

  cachedHeaders = headers

  return headers
}

export async function main() {
  try {
    await initSignin()
    await randomDelay(300, 1000)
    const record = await queryRecord()
    const today = new Date().toLocaleDateString('zh-CN').replaceAll('/', '-')
    const hasSignedInToday = record.some((r) => r.sigInDate.startsWith(today))
    if (hasSignedInToday) {
      console.log('Already signed in today')
      return
    } else {
      await randomDelay(300, 1000)
      await signIn()
    }
  } catch (error) {
    console.error('Error:', error)
  }
}

if (import.meta.main) {
  main()
}
