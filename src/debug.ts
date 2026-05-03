let _debug = false

export function setDebug(v: boolean): void {
  _debug = v
}

export function isDebug(): boolean {
  return _debug
}

export function debugLog(...args: unknown[]): void {
  if (_debug) console.log('[DEBUG]', ...args)
}
