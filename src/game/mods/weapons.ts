import {
  CF_SLOT_ORDER,
  cfWeaponTemplate,
  findCfWeapon,
  installModCfWeapon,
  isBuiltinCfWeapon,
  listModCfWeapons,
  setCfWeaponPatch,
  type CfRarity,
  type CfSlot,
  type CfWeaponSpec,
  type CfWeaponTag,
} from '@/game/world/cf'

import { recordModDiagnostic } from './diagnostics'
import { isHexColor } from './theme'
import { bumpModRegistry } from './version'

/**
 * 武器相关的 Mod 能力：新增武器 + 微调现有武器。
 *
 * 设计原则：
 * 1. Mod 只需要写想改的字段，其余从同槽位内置武器深拷贝，降低入门成本；
 * 2. 所有数字都夹紧到合法区间，避免 NaN / 负弹匣 / 0 射速把对局打崩；
 * 3. 结构字段（id / slot）不可改，注册后不可覆盖，保证唯一性和可追溯。
 */

export const MOD_WEAPON_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,47}$/

const TAGS: readonly CfWeaponTag[] = ['rifle', 'smg', 'sniper', 'machinegun', 'pistol', 'melee']
const RARITIES: readonly CfRarity[] = ['standard', 'rare', 'hero']
const FLAVORS = ['ak', 'm4', 'deagle', 'barrett', 'gatling', 'smg', 'suppressed', 'knife', 'shovel'] as const
const MAGS = ['curved', 'straight', 'drum', 'box', 'none'] as const
const STOCKS = ['wood', 'buffer', 'folding', 'none'] as const
const SKINS = ['flame', 'thunder'] as const
const BLADES = ['kukri', 'shovel'] as const

interface NumberRule {
  key: keyof CfWeaponSpec
  min: number
  max: number
  integer?: boolean
}

const WEAPON_NUMBER_RULES: readonly NumberRule[] = [
  { key: 'damage', min: 1, max: 500 },
  { key: 'rpm', min: 30, max: 3000 },
  { key: 'magazine', min: 1, max: 500, integer: true },
  { key: 'reserve', min: 0, max: 2000, integer: true },
  { key: 'reloadTime', min: 0.2, max: 10 },
  { key: 'drawTime', min: 0, max: 3 },
  { key: 'spread', min: 0, max: 20 },
  { key: 'moveSpread', min: 0, max: 30 },
  { key: 'airSpread', min: 0, max: 40 },
  { key: 'bloom', min: 0, max: 10 },
  { key: 'bloomMax', min: 0, max: 20 },
  { key: 'bloomRecovery', min: 0, max: 50 },
  { key: 'kick', min: 0, max: 2 },
  { key: 'armorPenetration', min: 0, max: 1 },
  { key: 'headshotMultiplier', min: 1, max: 10 },
  { key: 'legMultiplier', min: 0.1, max: 1 },
  { key: 'falloffStart', min: 1, max: 200 },
  { key: 'falloffEnd', min: 2, max: 400 },
  { key: 'minDamageRatio', min: 0.05, max: 1 },
  { key: 'pellets', min: 1, max: 24, integer: true },
  { key: 'zoomFov', min: 0.1, max: 1 },
  { key: 'zoomSpread', min: 0, max: 30 },
  { key: 'zoomRecoil', min: 0.2, max: 3 },
  { key: 'zoomMove', min: 0.2, max: 1 },
  { key: 'spinUp', min: 0, max: 5 },
]

const NUMBER_RULE_BY_KEY = new Map<string, NumberRule>(
  WEAPON_NUMBER_RULES.map((rule) => [rule.key as string, rule]),
)

/** Mod 可写的文本 / 枚举字段 */
const TEXT_KEYS = ['name', 'cn', 'desc'] as const

function clampNumber(value: number, rule: NumberRule): number {
  const clamped = Math.min(rule.max, Math.max(rule.min, value))
  return rule.integer ? Math.round(clamped) : Math.round(clamped * 1000) / 1000
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max) return null
  return text
}

export interface ModWeaponInput extends Partial<CfWeaponSpec> {
  id: string
  name: string
  slot: CfSlot
}

export interface ModWeaponResult {
  ok: boolean
  id?: string
  error?: string
}

/** 已注册武器的归属，用于冲突提示与调试 */
const weaponOwners = new Map<string, string>()

function sanitizeRecoil(
  input: unknown,
  fallback: CfWeaponSpec['recoil'],
): CfWeaponSpec['recoil'] | null {
  if (input === undefined) return fallback
  if (!input || typeof input !== 'object') return null
  const pattern = input as { pitch?: unknown; yaw?: unknown }
  const read = (value: unknown): number[] | null => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 24) return null
    const numbers = value.map((item) => Number(item))
    if (numbers.some((item) => !Number.isFinite(item) || Math.abs(item) > 5)) return null
    return numbers
  }
  const pitch = read(pattern.pitch)
  const yaw = read(pattern.yaw)
  if (!pitch || !yaw || pitch.length !== yaw.length) return null
  return { pitch, yaw }
}

function sanitizeSound(
  input: unknown,
  fallback: CfWeaponSpec['sound'],
): CfWeaponSpec['sound'] | null {
  if (input === undefined) return fallback
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const sound = { ...fallback }
  const numeric = sound as unknown as Record<string, number>
  const fields: [string, number, number][] = [
    ['body', 20, 800],
    ['crack', 100, 6000],
    ['noise', 0, 1],
    ['tail', 0, 2],
    ['gain', 0, 1],
  ]
  for (const [key, min, max] of fields) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    numeric[key] = Math.min(max, Math.max(min, value))
  }
  if (raw.flavor !== undefined) {
    if (typeof raw.flavor !== 'string' || !(FLAVORS as readonly string[]).includes(raw.flavor)) return null
    sound.flavor = raw.flavor as CfWeaponSpec['sound']['flavor']
  }
  return sound
}

function sanitizeModel(
  input: unknown,
  fallback: CfWeaponSpec['model'],
): CfWeaponSpec['model'] | null {
  if (input === undefined) return fallback
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const model = { ...fallback }
  for (const key of ['body', 'metal', 'furniture', 'accent'] as const) {
    const value = raw[key]
    if (value === undefined) continue
    if (!isHexColor(value)) return null
    model[key] = value
  }
  if (raw.barrel !== undefined) {
    if (typeof raw.barrel !== 'number' || !Number.isFinite(raw.barrel)) return null
    model.barrel = Math.min(2.5, Math.max(0.4, raw.barrel))
  }
  if (raw.mag !== undefined) {
    if (typeof raw.mag !== 'string' || !(MAGS as readonly string[]).includes(raw.mag)) return null
    model.mag = raw.mag as CfWeaponSpec['model']['mag']
  }
  if (raw.stock !== undefined) {
    if (typeof raw.stock !== 'string' || !(STOCKS as readonly string[]).includes(raw.stock)) return null
    model.stock = raw.stock as CfWeaponSpec['model']['stock']
  }
  if (raw.scope !== undefined) {
    if (typeof raw.scope !== 'boolean') return null
    model.scope = raw.scope
  }
  if (raw.skin !== undefined) {
    if (typeof raw.skin !== 'string' || !(SKINS as readonly string[]).includes(raw.skin)) return null
    model.skin = raw.skin as CfWeaponSpec['model']['skin']
  }
  if (raw.blade !== undefined) {
    if (typeof raw.blade !== 'string' || !(BLADES as readonly string[]).includes(raw.blade)) return null
    model.blade = raw.blade as CfWeaponSpec['model']['blade']
  }
  return model
}

function normalizeWeapon(input: ModWeaponInput): { spec?: CfWeaponSpec; error?: string } {
  if (!input || typeof input !== 'object') return { error: 'spec 必须是对象' }
  const { id, slot } = input
  if (typeof id !== 'string' || !MOD_WEAPON_ID_PATTERN.test(id)) {
    return { error: 'id 只能是小写字母、数字、点、横线、下划线，长度 2~48' }
  }
  if (isBuiltinCfWeapon(id)) return { error: `id 与内置武器冲突：${id}` }
  if (listModCfWeapons().some((weapon) => weapon.id === id)) return { error: `武器已注册：${id}` }
  if (!CF_SLOT_ORDER.includes(slot)) return { error: `slot 必须是 ${CF_SLOT_ORDER.join(' / ')}` }

  const name = readText(input.name, 24)
  if (!name) return { error: 'name 必须是 1~24 个字符' }
  const cn = input.cn === undefined ? name : readText(input.cn, 40)
  if (!cn) return { error: 'cn 必须是 1~40 个字符' }
  const desc = input.desc === undefined ? '' : readText(input.desc, 240)
  if (desc === null) return { error: 'desc 最多 240 个字符' }

  const template = cfWeaponTemplate(slot)
  const tag = input.tag ?? template.tag
  if (!TAGS.includes(tag)) return { error: 'tag 不合法' }
  if ((slot === 'melee') !== (tag === 'melee')) {
    return { error: 'tag 与 slot 不匹配：近战槽必须用 melee，其它槽位不能用 melee' }
  }

  const rarity = input.rarity ?? 'rare'
  if (!RARITIES.includes(rarity)) return { error: 'rarity 只能是 standard / rare / hero' }

  const spec: CfWeaponSpec = {
    ...template,
    id,
    name,
    cn,
    desc,
    slot,
    tag,
    rarity,
    selectable: true,
  }

  for (const rule of WEAPON_NUMBER_RULES) {
    const value = input[rule.key]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `字段 ${String(rule.key)} 必须是有限数字` }
    }
    ;(spec as unknown as Record<string, unknown>)[rule.key as string] = clampNumber(value, rule)
  }

  // 衰减区间必须自洽，否则远距离伤害会算出负数
  if (spec.falloffEnd <= spec.falloffStart) spec.falloffEnd = spec.falloffStart + 1

  const recoil = sanitizeRecoil(input.recoil, template.recoil)
  if (!recoil) return { error: 'recoil 必须是长度 1~24、pitch/yaw 等长的数组，单值 ≤ 5' }
  spec.recoil = recoil

  const sound = sanitizeSound(input.sound, template.sound)
  if (!sound) return { error: 'sound 字段不合法' }
  spec.sound = sound

  const model = sanitizeModel(input.model, template.model)
  if (!model) return { error: 'model 字段不合法（颜色用 #RRGGBB，枚举值需在文档范围内）' }
  spec.model = model

  return { spec }
}

export function registerModWeapon(input: ModWeaponInput, modId: string): ModWeaponResult {
  const { spec, error } = normalizeWeapon(input)
  if (!spec) {
    const message = error ?? '未知错误'
    recordModDiagnostic(modId, 'weapon.register', message)
    return { ok: false, error: message }
  }
  installModCfWeapon(spec)
  weaponOwners.set(spec.id, modId)
  bumpModRegistry()
  return { ok: true, id: spec.id }
}

export function patchModWeapon(
  id: string,
  patch: Partial<CfWeaponSpec>,
  modId: string,
): ModWeaponResult {
  const target = findCfWeapon(id)
  if (!target) {
    const message = `未找到武器：${id}`
    recordModDiagnostic(modId, 'weapon.patch', message)
    return { ok: false, error: message }
  }
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'patch 必须是对象' }
  if ('id' in patch || 'slot' in patch) {
    return { ok: false, error: 'id 与 slot 是结构字段，不能通过 patch 修改' }
  }

  const clean: Partial<CfWeaponSpec> = {}
  for (const [key, value] of Object.entries(patch)) {
    if ((TEXT_KEYS as readonly string[]).includes(key)) {
      const text = readText(value, key === 'desc' ? 240 : 40)
      if (text === null) return { ok: false, error: `字段 ${key} 文本不合法` }
      ;(clean as unknown as Record<string, unknown>)[key] = text
      continue
    }
    const rule = NUMBER_RULE_BY_KEY.get(key)
    if (!rule) return { ok: false, error: `字段 ${key} 不允许修改` }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `字段 ${key} 必须是有限数字` }
    }
    ;(clean as unknown as Record<string, unknown>)[key] = clampNumber(value, rule)
  }
  if (Object.keys(clean).length === 0) return { ok: false, error: 'patch 为空' }

  setCfWeaponPatch(id, clean)
  // 如果改的是 Mod 武器，归属不变；改内置武器时记录是谁改的，方便排查数值冲突
  if (!weaponOwners.has(id)) weaponOwners.set(id, modId)
  bumpModRegistry()
  return { ok: true, id }
}

export function listWeaponOwners(): { id: string; modId: string; builtin: boolean }[] {
  return [...weaponOwners.entries()].map(([id, modId]) => ({ id, modId, builtin: isBuiltinCfWeapon(id) }))
}
