import { loadConfig } from './config.ts'
import { getAllPlatforms } from './platforms/registry.ts'

// Import platform registrations (side effects)
import './platforms/kurobbs/index.ts'
import './platforms/tajiduo/index.ts'

/**
 * 运行所有已通过 config 启用的平台签到
 */
export async function runAll(): Promise<void> {
  const config = await loadConfig()
  const platforms = getAllPlatforms()

  const enabled = Array.from(platforms.entries()).filter(([, p]) => p.isEnabled(config))

  if (enabled.length === 0) {
    console.log('未启用任何签到平台，请检查配置文件')
    return
  }

  console.log(`已启用 ${enabled.length} 个签到平台: ${enabled.map(([, p]) => p.name).join(', ')}`)

  for (const [key, platform] of enabled) {
    console.log(`\n--- 开始执行: ${platform.name} ---`)
    try {
      await platform.run(config)
      console.log(`--- 完成: ${platform.name} ---`)
    } catch (err) {
      console.error(`--- 失败: ${platform.name} ---`)
      console.error(err)
    }
  }
}
