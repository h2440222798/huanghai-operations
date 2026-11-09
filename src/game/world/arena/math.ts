import type { HitPart, WeaponSpec } from './types'

/* ---------------- 随机与噪声 ---------------- */

/** 可复现的伪随机数发生器（mulberry32） */
export function createRandom(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] ?? items[0]!,
  }
}

export type Random = ReturnType<typeof createRandom>

function hash2d(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return value - Math.floor(value)
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** 二维值噪声 */
export function createNoise2d(seed = 1) {
  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = smoothstep(x - xi)
    const yf = smoothstep(y - yi)
    const a = hash2d(xi, yi, seed)
    const b = hash2d(xi + 1, yi, seed)
    const c = hash2d(xi, yi + 1, seed)
    const d = hash2d(xi + 1, yi + 1, seed)
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf
  }
}

/** 分形噪声，返回 0~1 */
export function createFbm2d(seed = 1, octaves = 4) {
  const noise = createNoise2d(seed)
  return (x: number, y: number) => {
    let value = 0
    let amplitude = 0.5
    let frequency = 1
    let total = 0
    for (let i = 0; i < octaves; i += 1) {
      value += noise(x * frequency, y * frequency) * amplitude
      total += amplitude
      amplitude *= 0.5
      frequency *= 2.13
    }
    return value / total
  }
}

/* ---------------- 数值工具 ---------------- */

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** 与帧率无关的指数逼近 */
export const damp = (current: number, target: number, lambda: number, delta: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * delta))

export const degToRad = (deg: number) => (deg * Math.PI) / 180
export const radToDeg = (rad: number) => (rad * 180) / Math.PI

export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export function formatCoin(value: number) {
  return `$${Math.max(0, Math.round(value)).toLocaleString('en-US')}`
}

/* ---------------- 武器数值模型 ---------------- */

export interface SpreadInput {
  moving: boolean
  airborne: boolean
  crouching: boolean
  zoomed: boolean
  /** 连续开火发数（用于连射散布累积） */
  shotsFired: number
}

/** 当前实际散布（度）；开镜时使用望远镜散布 */
export function effectiveSpread(weapon: WeaponSpec, input: SpreadInput): number {
  if (input.zoomed && weapon.zoomSpread !== undefined) {
    return weapon.zoomSpread + (input.moving ? 0.22 : 0)
  }
  let spread = weapon.spread
  if (input.moving) spread += weapon.moveSpread
  if (input.airborne) spread += weapon.airSpread
  if (input.crouching && !input.moving) spread *= 0.6
  spread += Math.min(input.shotsFired * 0.14, weapon.spread * 2.2 + 1.1)
  return spread
}

/** 把散布角换算成屏幕上的准星张开像素 */
export function spreadToPixels(spreadDeg: number, fovDeg: number, viewportHeight: number) {
  const half = Math.max(1, viewportHeight) / 2
  const base = Math.tan(degToRad(fovDeg) / 2)
  if (base <= 0) return 0
  return (Math.tan(degToRad(Math.max(0, spreadDeg))) / base) * half
}

/** 连发后坐图案：先向上再左右摆动 */
export function recoilPunch(weapon: WeaponSpec, shotIndex: number) {
  const index = Math.max(0, shotIndex)
  const climbFactor = index < 4 ? 1 : index < 10 ? 0.7 : 0.42
  const pitch = weapon.recoil * climbFactor * (0.85 + (index % 3) * 0.07)
  const swayFactor = index < 2 ? 0.25 : 1
  const yaw = weapon.recoilSide * Math.sin(index * 0.82 + 0.4) * swayFactor
  return { pitch, yaw }
}

/** 距离衰减：超出有效射程后线性衰减，最低保留 55% */
export function applyDamageFalloff(damage: number, distance: number, range: number, falloffRange: number) {
  if (distance <= range) return damage
  const ratio = Math.min(1, (distance - range) / Math.max(1, falloffRange))
  return damage * (1 - ratio * 0.45)
}

/** 单发命中伤害：距离衰减 + 部位倍率 */
export function computeHitDamage(weapon: WeaponSpec, part: HitPart, distance: number) {
  let damage = applyDamageFalloff(weapon.damage, distance, weapon.range, weapon.falloffRange)
  if (part === 'head') damage *= weapon.headshotMultiplier
  else if (part === 'leg') damage *= weapon.legMultiplier
  return Math.max(1, Math.round(damage))
}

/** CS 式护甲减伤：护甲吸收部分伤害，自身按比例磨损 */
export function applyArmor(rawDamage: number, health: number, armor: number, penetration: number) {
  if (armor <= 0) {
    return { health: Math.max(0, health - rawDamage), armor: 0 }
  }
  const pen = clamp(penetration, 0, 1)
  const healthDamage = rawDamage * pen
  const armorDamage = rawDamage * (1 - pen) * 0.6
  return {
    health: Math.max(0, health - healthDamage),
    armor: Math.max(0, armor - armorDamage),
  }
}

/** 命中率（百分比，保留一位小数） */
export function accuracyPercent(hits: number, shots: number) {
  if (shots <= 0) return 0
  return Math.round((hits / shots) * 1000) / 10
}

/** 波次敌人构成：数量随波次与天体强度递增 */
export function waveEnemyCount(planetStart: number, perWave: number, wave: number) {
  return planetStart + Math.round(perWave * (wave - 1) * 1.35)
}

/** 击杀得分：爆头额外奖励 */
export function killScore(baseScore: number, headshot: boolean, wave: number) {
  const bonus = headshot ? 1.6 : 1
  return Math.round(baseScore * bonus * (1 + (wave - 1) * 0.12))
}

/** 屏幕方向（-PI..PI）：用于受击方向指示，0 表示正前方，正值在右 */
export function relativeHitAngle(cameraYaw: number, sourceX: number, sourceZ: number, playerX: number, playerZ: number) {
  // 相机默认朝向 -Z，偏航后前向为 (-sin(yaw), 0, -cos(yaw))
  const forwardAngle = Math.atan2(-Math.sin(cameraYaw), -Math.cos(cameraYaw))
  const sourceAngle = Math.atan2(sourceX - playerX, sourceZ - playerZ)
  let diff = forwardAngle - sourceAngle
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}
