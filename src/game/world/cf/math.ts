import type { CfWeaponSpec } from './weapons'

/* ============================== 基础数学 ============================== */

export const cfClamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export const cfLerp = (a: number, b: number, t: number) => a + (b - a) * t

export const degToRad = (deg: number) => (deg * Math.PI) / 180

export const radToDeg = (rad: number) => (rad * 180) / Math.PI

/** 与帧率无关的指数逼近 */
export const cfDamp = (current: number, target: number, lambda: number, delta: number) =>
  cfLerp(current, target, 1 - Math.exp(-lambda * delta))

/* ============================== 散布 ============================== */

export interface CfSpreadInput {
  moving: boolean
  airborne: boolean
  /** 本轮连射中「已经打出去」的弹数：首发为 0 */
  shotsFired: number
  zoomed: boolean
  /** 当前连射散布（度）；由战斗层维护时优先使用，缺省则按发数估算 */
  bloom?: number
}

/**
 * CF 式散布：首发极准，连发按发数线性扩张；移动 / 腾空惩罚很重。
 * 开镜武器使用独立的固定散布（开镜后几乎指哪打哪）。
 */
export function cfSpread(weapon: CfWeaponSpec, input: CfSpreadInput): number {
  if (weapon.slot === 'melee') return 0
  if (input.zoomed && weapon.zoomSpread !== undefined) {
    return weapon.zoomSpread + (input.moving ? 0.12 : 0)
  }
  let spread = weapon.spread
  if (input.moving) spread += weapon.moveSpread
  if (input.airborne) spread += weapon.airSpread
  const bloom = input.bloom ?? Math.max(0, input.shotsFired) * weapon.bloom
  spread += Math.min(Math.max(0, bloom), weapon.bloomMax)
  return spread
}

/** 停火后连射散布的恢复量（度） */
export function cfBloomAfterIdle(weapon: CfWeaponSpec, delta: number, shotsFired: number): number {
  return Math.max(0, shotsFired - weapon.bloomRecovery * delta)
}

/** 散布角换算成屏幕准星张开像素 */
export function cfSpreadPx(spreadDeg: number, fovDeg: number, viewportHeight: number): number {
  const half = Math.max(1, viewportHeight) / 2
  const base = Math.tan(degToRad(fovDeg) / 2)
  if (base <= 0) return 0
  return (Math.tan(degToRad(Math.max(0, spreadDeg))) / base) * half
}

/* ============================== 后坐力 ============================== */

export interface CfRecoilKick {
  /** 相机上扬（弧度） */
  pitch: number
  /** 相机水平偏移（弧度，正为右） */
  yaw: number
}

/**
 * 取第 shotIndex 发（0 开始）的固定弹道。
 * CF 的枪械弹道是「表格化」的：AK 的第 4 发起向右压、第 9 发起回摆，
 * 所以压枪练的是固定路线，而不是纯随机抖动。
 */
export function cfRecoilForShot(weapon: CfWeaponSpec, shotIndex: number, zoomed = false): CfRecoilKick {
  const pattern = weapon.recoil
  const length = Math.max(1, pattern.pitch.length)
  const index = ((shotIndex % length) + length) % length
  const zoomScale = zoomed ? weapon.zoomRecoil ?? 1 : 1
  const pitch = (pattern.pitch[index] ?? 0) * zoomScale
  const yaw = (pattern.yaw[index] ?? 0) * zoomScale
  return { pitch: degToRad(pitch), yaw: degToRad(yaw) }
}

/**
 * 把后坐力加到射击方向上：先绕 right 上抬、再绕 up 侧偏。
 * right / up 与 direction 正交，因此可以直接用「基向量合成」而不是通用旋转矩阵。
 */
export function cfApplyRecoilToDirection(
  direction: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
  kick: CfRecoilKick,
) {
  const cp = Math.cos(kick.pitch)
  const sp = Math.sin(kick.pitch)
  const cy = Math.cos(kick.yaw)
  const sy = Math.sin(kick.yaw)
  // 上抬：dir·cos(p) + up·sin(p)
  const px = direction.x * cp + up.x * sp
  const py = direction.y * cp + up.y * sp
  const pz = direction.z * cp + up.z * sp
  // 侧偏：p·cos(y) + right·sin(y)
  const x = px * cy + right.x * sy
  const y = py * cy + right.y * sy
  const z = pz * cy + right.z * sy
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

/* ============================== 伤害 ============================== */

/** 距离衰减：起点内满伤，终点外保留 minRatio，中间平滑过渡 */
export function cfFalloff(
  damage: number,
  distance: number,
  falloffStart: number,
  falloffEnd: number,
  minRatio: number,
) {
  if (distance <= falloffStart) return damage
  const span = Math.max(0.001, falloffEnd - falloffStart)
  const t = cfClamp((distance - falloffStart) / span, 0, 1)
  const eased = t * t * (3 - 2 * t)
  return damage * (1 - (1 - minRatio) * eased)
}

/** 单发命中伤害：距离衰减 + 部位倍率（CF 口径：躯干 / 头 / 腿） */
export function cfDamage(weapon: CfWeaponSpec, part: 'head' | 'body' | 'leg', distance: number): number {
  const base = cfFalloff(
    weapon.damage,
    Math.max(0, distance),
    weapon.falloffStart,
    weapon.falloffEnd,
    weapon.minDamageRatio,
  )
  const multiplier = part === 'head' ? weapon.headshotMultiplier : part === 'leg' ? weapon.legMultiplier : 1
  return Math.max(1, Math.round(base * multiplier))
}

/** CF 式护甲：穿甲系数越高，越多的伤害直接打进生命值 */
export function cfApplyArmor(
  rawDamage: number,
  health: number,
  armor: number,
  penetration: number,
) {
  if (armor <= 0) return { health: Math.max(0, health - rawDamage), armor: 0 }
  const pen = cfClamp(penetration, 0, 1)
  const healthDamage = rawDamage * pen
  const armorDamage = rawDamage * (1 - pen) * 0.75
  return {
    health: Math.max(0, health - healthDamage),
    armor: Math.max(0, armor - armorDamage),
  }
}

/* ============================== 连杀 ============================== */

/** CF 挑战模式的连杀播报 */
export function killStreakLabel(streak: number): string {
  if (streak >= 8) return '超神'
  if (streak === 7) return '不死'
  if (streak === 6) return '暴走'
  if (streak === 5) return '五杀'
  if (streak === 4) return '四杀'
  if (streak === 3) return '三杀'
  if (streak === 2) return '双杀'
  return ''
}

/** 连杀计分倍率：连杀越高，单杀得分越多 */
export function killStreakMultiplier(streak: number): number {
  return 1 + Math.min(1.5, Math.max(0, streak - 1) * 0.15)
}

/* ============================== HUD ============================== */

export function cfFormatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function cfAccuracy(hits: number, shots: number): number {
  if (shots <= 0) return 0
  return Math.round((hits / shots) * 1000) / 10
}
