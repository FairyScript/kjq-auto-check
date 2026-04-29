import type { CheckInPlatform } from './types.ts'
import { KuroBBSPlatform } from './platforms/kurobbs/index.ts'
import { TajiduoPlatform } from './platforms/tajiduo/index.ts'

/**
 * 所有可用平台列表。
 * 新增平台时，在此处实例化并添加即可。
 */
const ALL_PLATFORMS: CheckInPlatform[] = [
  new KuroBBSPlatform(),
  new TajiduoPlatform()
]

/**
 * 运行所有已通过 env 启用的平台签到
 */
export async function runAll(): Promise<void> {
  const enabled = ALL_PLATFORMS.filter((p) => p.isEnabled())

  if (enabled.length === 0) {
    console.log('未启用任何签到平台，请检查环境变量配置')
    return
  }

  console.log(`已启用 ${enabled.length} 个签到平台: ${enabled.map((p) => p.name).join(', ')}`)

  for (const platform of enabled) {
    console.log(`\n--- 开始执行: ${platform.name} ---`)
    try {
      await platform.run()
      console.log(`--- 完成: ${platform.name} ---`)
    } catch (err) {
      console.error(`--- 失败: ${platform.name} ---`)
      console.error(err)
    }
  }
}
