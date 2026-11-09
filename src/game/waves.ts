import { cfClamp } from './world/cf'
import type { EnemyKindId } from './world/arena/types'

/**
 * 挑战模式的 30 波配比（沿用 04 项目里打磨过的数值）：
 * - 主力始终是近战怪兽，第 4 波起混入迅捷猎手、第 7 波起远程步兵、第 12 波起无人机；
 * - 每 10 波一个 BOSS 波（只放一只强化巨兽，避免整波变成子弹海绵），第 30 波终局。
 */
export const TOTAL_WAVES = 30

/** 校园场景下的敌人血量缩放：让 AK 4 发躯干 / 1 发爆头解决第一波小怪 */
export const CF_ENEMY_HP_SCALE = 0.4

export interface SpawnGroup {
  kind: EnemyKindId
  count: number
  hpScale: number
  speedScale: number
  damageScale: number
}

export interface WavePlan {
  wave: number
  isBossWave: boolean
  label: string
  groups: SpawnGroup[]
  total: number
}

export function makeWavePlan(wave: number): WavePlan {
  const w = cfClamp(Math.round(wave), 1, TOTAL_WAVES)
  const isBossWave = w % 10 === 0
  const hpScale = 1 + (w - 1) * 0.1
  const speedScale = Math.min(1 + (w - 1) * 0.025, 1.55)
  const damageScale = 1 + (w - 1) * 0.055
  const countBase = 4 + Math.floor(w * 1.3)

  const groups: SpawnGroup[] = []
  const bruteCount = Math.max(3, Math.round(countBase * (isBossWave ? 0.45 : 0.72)))
  if (isBossWave) {
    groups.push({ kind: 'brute', count: 1, hpScale: hpScale * 2.2, speedScale, damageScale })
  }
  groups.push({
    kind: 'brute',
    count: Math.max(2, bruteCount - (isBossWave ? 1 : 0)),
    hpScale,
    speedScale,
    damageScale,
  })
  if (w >= 4) {
    groups.push({
      kind: 'skirmisher',
      count: Math.max(2, Math.round(countBase * 0.28)),
      hpScale,
      speedScale: speedScale * 1.05,
      damageScale,
    })
  }
  if (w >= 7) {
    groups.push({ kind: 'grunt', count: Math.max(1, Math.round(countBase * 0.22)), hpScale, speedScale, damageScale })
  }
  if (w >= 12) {
    groups.push({ kind: 'drone', count: Math.max(1, Math.round(countBase * 0.14)), hpScale, speedScale, damageScale })
  }

  const total = groups.reduce((sum, g) => sum + g.count, 0)
  return {
    wave: w,
    isBossWave,
    label: w === TOTAL_WAVES ? '终局决战 · 生化母巢' : isBossWave ? `第 ${w} 波 · BOSS 来袭` : `第 ${w} 波`,
    groups,
    total,
  }
}

/** 各模式的敌人显示名，避免在校园里出现「异星步兵」这种出戏称呼 */
const ENEMY_ALIAS: Record<string, Record<EnemyKindId, string>> = {
  classic: { grunt: '潜伏者·突击兵', skirmisher: '潜伏者·游走', brute: '潜伏者·重装', drone: '侦察无人机' },
  bomb: { grunt: '潜伏者·守包兵', skirmisher: '潜伏者·游走', brute: '潜伏者·重装', drone: '侦察无人机' },
  bio: { grunt: '感染体·吐酸者', skirmisher: '感染体·猎杀者', brute: '感染体·撕裂者', drone: '感染体·飞蝠' },
  challenge: { grunt: '异星步兵', skirmisher: '迅捷猎手', brute: '重装撕裂者', drone: '浮空无人机' },
  delta: { grunt: '红方·步枪兵', skirmisher: '红方·突击手', brute: '红方·重装机枪手', drone: '红方·无人机' },
}

export function enemyAlias(mode: keyof typeof ENEMY_ALIAS, kind: EnemyKindId): string {
  return ENEMY_ALIAS[mode]?.[kind] ?? kind
}

export const PICKUP_CHANCE = { health: 0.09, armor: 0.05, ammo: 0.16 } as const
