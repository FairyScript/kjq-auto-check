import { registerPlatform } from '../registry.ts'
import { setupKuroBBS } from './setup.ts'
import { runKuroBBS } from './worker.ts'
import type { Config } from '../../config.ts'

registerPlatform('kurobbs', {
  name: '库洛社区 (KuroBBS)',
  async setup() {
    return { platformKey: 'kurobbs', config: await setupKuroBBS() }
  },
  isEnabled(config: Config) {
    return config.kurobbs?.enabled === true
  },
  async run(config: Config) {
    if (!config.kurobbs) throw new Error('[KuroBBS] 配置不存在')
    await runKuroBBS(config.kurobbs)
  },
})
