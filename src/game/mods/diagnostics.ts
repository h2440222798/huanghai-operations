/**
 * Mod 诊断信息：注册被拒绝、事件回调抛错都会记到这里，玩家/作者可以在控制台或
 * `HuangHai.getErrors()` 看到，而不是静默失败。
 */

export interface ModDiagnostic {
  modId: string
  scope: string
  message: string
  /** 毫秒时间戳 */
  at: number
}

const MAX_ENTRIES = 60
const entries: ModDiagnostic[] = []

export function recordModDiagnostic(modId: string, scope: string, message: string): void {
  entries.push({ modId, scope, message, at: Date.now() })
  if (entries.length > MAX_ENTRIES) entries.shift()
  // 只在控制台留一条，方便作者定位；不打断游戏
  console.warn(`[黄海行动 · 创意工坊] ${modId} / ${scope}: ${message}`)
}

export function listModDiagnostics(): ModDiagnostic[] {
  return entries.map((entry) => ({ ...entry }))
}

export function clearModDiagnostics(): void {
  entries.length = 0
}
