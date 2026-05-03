// worker.ts
import { setDebug } from './src/debug.ts'
import { runAll } from './src/runner.ts'

if (process.argv.includes('--debug')) setDebug(true)
await runAll()
