import type { GameModeId, MatchHud, MatchResult } from '@/game/types'

import { recordModDiagnostic } from './diagnostics'

/**
 * 创意工坊事件表。
 *
 * 所有 payload 都是「快照」而不是引擎内部对象：Mod 只能读，改它不会影响对局。
 * 需要更细的运行时能力时，优先通过 `notice` / 自定义 DOM 呈现，别去动游戏内部状态。
 */
export interface ModKillPayload {
  mode: GameModeId
  /** 敌人种类 ID，例如 brute / drone */
  kind: string
  /** 当前模式下的显示名，例如「潜伏者·重装」 */
  name: string
  headshot: boolean
  /** true 表示这次击杀算在 AI 队友头上 */
  byAlly: boolean
  /** 玩家当前连杀数（队友击杀为 0） */
  streak: number
}

export interface ModWavePayload {
  wave: number
  total: number
  isBossWave: boolean
  label: string
  /** 本波敌人数 */
  count: number
}

export interface ModDamagePayload {
  /** 经护甲结算前的实际扣血值 */
  amount: number
  source: string
  health: number
  armor: number
}

export interface ModMatchStartPayload {
  mode: GameModeId
  modeName: string
  /** 开局配枪的武器 ID */
  loadout: { primary: string; secondary: string; melee: string }
}

export interface ModLobbyReadyPayload {
  modes: { id: GameModeId; name: string }[]
  /** 已启用的 Mod 数量 */
  modCount: number
}

export interface ModEventMap {
  'lobby:ready': ModLobbyReadyPayload
  'match:start': ModMatchStartPayload
  'match:end': MatchResult
  'enemy:killed': ModKillPayload
  'wave:start': ModWavePayload
  'player:damaged': ModDamagePayload
  /** 约 5Hz 的 HUD 快照，用于自定义叠层；不要在这里做重活 */
  hud: MatchHud
}

export type ModEventName = keyof ModEventMap
export type ModEventHandler<T extends ModEventName = ModEventName> = (payload: ModEventMap[T]) => void

interface Listener {
  modId: string
  handler: (payload: unknown) => void
}

const EVENT_NAMES: readonly ModEventName[] = [
  'lobby:ready',
  'match:start',
  'match:end',
  'enemy:killed',
  'wave:start',
  'player:damaged',
  'hud',
]

const listeners = new Map<ModEventName, Listener[]>()

export function isModEventName(name: string): name is ModEventName {
  return (EVENT_NAMES as readonly string[]).includes(name)
}

export function listModEventNames(): ModEventName[] {
  return [...EVENT_NAMES]
}

export function onModEvent<T extends ModEventName>(
  event: T,
  modId: string,
  handler: ModEventHandler<T>,
): () => void {
  if (typeof handler !== 'function') throw new Error('handler 必须是函数')
  const bucket = listeners.get(event) ?? []
  const listener: Listener = { modId, handler: handler as (payload: unknown) => void }
  bucket.push(listener)
  listeners.set(event, bucket)
  return () => offModEvent(event, handler, modId)
}

export function offModEvent<T extends ModEventName>(
  event: T,
  handler: ModEventHandler<T>,
  modId?: string,
): void {
  const bucket = listeners.get(event)
  if (!bucket) return
  const next = bucket.filter(
    (listener) => !(listener.handler === (handler as unknown) && (!modId || listener.modId === modId)),
  )
  if (next.length > 0) listeners.set(event, next)
  else listeners.delete(event)
}

/** 游戏内部调用：向所有 Mod 广播事件，单个 Mod 抛错不影响其它 Mod 和对局 */
export function emitModEvent<T extends ModEventName>(event: T, payload: ModEventMap[T]): void {
  const bucket = listeners.get(event)
  if (!bucket || bucket.length === 0) return
  const snapshot = Object.freeze({ ...payload })
  for (const listener of [...bucket]) {
    try {
      listener.handler(snapshot)
    } catch (error) {
      recordModDiagnostic(
        listener.modId,
        `event:${event}`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

/** 卸载全部监听（换局 / 退出时不需要，这里只给测试和热重载用） */
export function clearModListeners(): void {
  listeners.clear()
}
