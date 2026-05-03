import { registerPlatform } from '../registry.ts'
import { setupTajiduo } from './setup.ts'
import { runTajiduo } from './worker.ts'
import type { Config } from '../../config.ts'

registerPlatform('tajiduo', {
  name: '塔吉多 (Tajiduo)',
  async setup() {
    return { platformKey: 'tajiduo', config: await setupTajiduo() }
  },
  isEnabled(config: Config) {
    return config.tajiduo?.enabled === true
  },
  async run(config: Config) {
    if (!config.tajiduo) throw new Error('[Tajiduo] 配置不存在')
    await runTajiduo(config.tajiduo)
  },
})
