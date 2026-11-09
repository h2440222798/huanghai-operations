/**
 * 创意工坊「对局数值」注册表。
 *
 * 每个 Mod 只保存自己的一份系数（不全量覆盖），最终生效值是所有 Mod 系数的乘积，
 * 这样多个 Mod 同时调整同一项时不会互相抹掉，也不会因为重复调用而指数放大。
 */

export interface ModBalance {
  /** 敌人血量倍率 */
  enemyHealth: number
  /** 敌人伤害倍率 */
  enemyDamage: number
  /** 敌人移动速度倍率 */
  enemySpeed: number
  /** 玩家脱战回血速度倍率（0 = 关闭回血） */
  playerRegen: number
  /** 击杀补给掉落概率倍率 */
  pickupChance: number
  /** AI 队友伤害倍率 */
  allyDamage: number
  /** 挑战模式每波敌人数量倍率 */
  waveCount: number
}

export const MOD_BALANCE_KEYS = [
  'enemyHealth',
  'enemyDamage',
  'enemySpeed',
  'playerRegen',
  'pickupChance',
  'allyDamage',
  'waveCount',
] as const satisfies readonly (keyof ModBalance)[]

/** 单项系数的合法区间：越界的值会被夹紧，而不是让对局崩掉 */
export const MOD_BALANCE_LIMITS: Record<keyof ModBalance, readonly [number, number]> = {
  enemyHealth: [0.2, 5],
  enemyDamage: [0.1, 5],
  enemySpeed: [0.5, 2.5],
  playerRegen: [0, 5],
  pickupChance: [0, 5],
  allyDamage: [0, 5],
  waveCount: [0.5, 3],
}

export const DEFAULT_MOD_BALANCE: ModBalance = {
  enemyHealth: 1,
  enemyDamage: 1,
  enemySpeed: 1,
  playerRegen: 1,
  pickupChance: 1,
  allyDamage: 1,
  waveCount: 1,
}

const contributions = new Map<string, Partial<ModBalance>>()

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/** 校验并夹紧单个字段；返回 null 表示字段不合法 */
export function sanitizeBalanceValue(key: keyof ModBalance, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const [min, max] = MOD_BALANCE_LIMITS[key]
  return clamp(value, min, max)
}

export interface BalancePatchResult {
  ok: boolean
  error?: string
  applied?: Partial<ModBalance>
}

/** 写入某个 Mod 的数值系数（覆盖该 Mod 上一次的设置，不影响其它 Mod） */
export function setModBalance(modId: string, patch: Partial<ModBalance>): BalancePatchResult {
  const entries = Object.entries(patch)
  if (entries.length === 0) return { ok: false, error: 'patch 为空' }

  const next: Partial<ModBalance> = { ...(contributions.get(modId) ?? {}) }
  for (const [rawKey, rawValue] of entries) {
    if (!(MOD_BALANCE_KEYS as readonly string[]).includes(rawKey)) {
      return { ok: false, error: `未知数值字段 ${rawKey}` }
    }
    const key = rawKey as keyof ModBalance
    const value = sanitizeBalanceValue(key, rawValue)
    if (value === null) return { ok: false, error: `字段 ${rawKey} 必须是有限数字` }
    next[key] = value
  }
  contributions.set(modId, next)
  return { ok: true, applied: next }
}

export function clearModBalance(modId: string): void {
  contributions.delete(modId)
}

/** 所有 Mod 系数的乘积，已在合法区间内收口 */
export function getModBalance(): ModBalance {
  const result: ModBalance = { ...DEFAULT_MOD_BALANCE }
  for (const patch of contributions.values()) {
    for (const key of MOD_BALANCE_KEYS) {
      const value = patch[key]
      if (value !== undefined) result[key] *= value
    }
  }
  for (const key of MOD_BALANCE_KEYS) {
    const [min, max] = MOD_BALANCE_LIMITS[key]
    result[key] = clamp(result[key], min, max)
  }
  return result
}

/** 调试 / 文档用途：当前有哪些 Mod 在改数值 */
export function listModBalanceContributions(): { modId: string; patch: Partial<ModBalance> }[] {
  return [...contributions.entries()].map(([modId, patch]) => ({ modId, patch: { ...patch } }))
}
