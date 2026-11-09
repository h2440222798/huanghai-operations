import { GAME_MODES, MODE_ORDER } from '@/game/meta'
import type { GameModeId } from '@/game/types'
import { listModCfWeapons, weaponsForSlot, type CfWeaponSpec } from '@/game/world/cf'

import { getModBalance, setModBalance, type ModBalance } from './balance'
import {
  emitModEvent,
  listModEventNames,
  offModEvent,
  onModEvent,
  type ModEventMap,
  type ModEventName,
} from './bus'
import { isGameplayActive } from './context'
import { listModDiagnostics, recordModDiagnostic, type ModDiagnostic } from './diagnostics'
import {
  getActiveModThemeId,
  listModThemes,
  registerModTheme,
  useModTheme,
  type ModTheme,
} from './theme'
import { bumpModRegistry } from './version'
import {
  patchModWeapon,
  registerModWeapon,
  type ModWeaponInput,
  type ModWeaponResult,
} from './weapons'

/** 公共 API 语义版本：破坏性变更时才 +1，Mod 用它做兼容判断 */
export const MOD_API_VERSION = 1
/** 游戏版本，仅用于文档与诊断 */
export const GAME_VERSION = '1.1.0'

export const MOD_API_GLOBAL = 'HuangHai'

/* ============================== 公开类型 ============================== */

export interface ModNoticeOptions {
  /** info（默认）/ warn / good */
  tone?: 'info' | 'warn' | 'good'
  /** 毫秒，默认 2600，最大 8000 */
  duration?: number
}

export interface ModActionResult {
  ok: boolean
  error?: string
}

export interface WorkshopModInfo {
  id: string
  title: string
  version: string
  loadPhase: 'before-start' | 'after-start'
  capabilities: string[]
}

export interface WorkshopCapabilityInfo {
  id: string
  name: string
  multiplayer: 'local' | 'blocked'
}

export interface WorkshopInfo {
  /** 是否检测到平台 Loader（本地单独打开时为 false） */
  available: boolean
  /** 联机策略：本作固定 mods-disabled */
  policy: 'mods-disabled' | 'author-managed'
  /** 作者发布的能力目录 */
  capabilities: WorkshopCapabilityInfo[]
  /** 当前已启用的 Mod */
  mods: WorkshopModInfo[]
}

/** 绑定到某个 Mod 的 API，事件与提示都会带上该 Mod 的身份 */
export interface HuangHaiModApi {
  readonly modId: string
  /** 注册一把新武器（返回结果而不是抛异常） */
  registerWeapon(input: ModWeaponInput): ModWeaponResult
  /** 微调已有武器（内置或 Mod 武器） */
  patchWeapon(id: string, patch: Partial<CfWeaponSpec>): ModWeaponResult
  /** 调整对局数值系数（与本 Mod 上一次的设置合并，不与其它 Mod 相乘覆盖） */
  patchBalance(patch: Partial<ModBalance>): ModActionResult
  /** 注册 HUD 主题（第一个注册的自动生效） */
  registerTheme(theme: ModTheme): ModActionResult
  /** 切换主题；传 null 恢复默认配色 */
  useTheme(id: string | null): ModActionResult
  /** 订阅事件，返回取消订阅函数 */
  on<T extends ModEventName>(event: T, handler: (payload: ModEventMap[T]) => void): () => void
  off<T extends ModEventName>(event: T, handler: (payload: ModEventMap[T]) => void): void
  /** 在 HUD 底部弹一条提示，纯文本，不支持 HTML */
  notice(text: string, options?: ModNoticeOptions): void
}

export interface HuangHaiApi extends HuangHaiModApi {
  readonly apiVersion: number
  readonly version: string
  /** 可订阅的事件名列表 */
  readonly events: readonly ModEventName[]
  /** 把后续调用归属到指定 Mod（在异步回调里注册时用） */
  forMod(modId: string): HuangHaiModApi
  getBalance(): ModBalance
  getWeapons(): CfWeaponSpec[]
  getThemes(): ModTheme[]
  getActiveThemeId(): string | null
  getMods(): WorkshopModInfo[]
  getWorkshop(): WorkshopInfo
  getErrors(): ModDiagnostic[]
  /** 内部：启动前 Mod 加载完成后调用 */
  __commit(): void
  /** 内部：大厅挂载完成后调用 */
  __lobbyReady(): void
}

/* ============================== 运行时状态 ============================== */

function readWorkshop() {
  return typeof window === 'undefined' ? null : window.VibeHubWorkshop ?? null
}

/** 当前正在加载的 Mod（官方 loader 在 script.onload 前设置） */
function currentModId(): string {
  return readWorkshop()?.currentMod?.id ?? 'anonymous'
}

function resolveModId(explicit?: string): string {
  return explicit || currentModId()
}

function describeWorkshop(): WorkshopInfo {
  const workshop = readWorkshop()
  const mods = workshop?.getEnabledMods?.() ?? []
  return {
    available: Boolean(workshop),
    policy: workshop?.multiplayerPolicy === 'author-managed' ? 'author-managed' : 'mods-disabled',
    capabilities: (workshop?.capabilities ?? []).map((capability) => ({
      id: capability.id,
      name: capability.name ?? capability.id,
      multiplayer: capability.multiplayer === 'blocked' ? 'blocked' : 'local',
    })),
    mods: mods.map((mod) => ({
      id: mod.id,
      title: mod.title ?? mod.id,
      version: mod.version ?? '',
      loadPhase: mod.loadPhase === 'after-start' ? 'after-start' : 'before-start',
      capabilities: Array.isArray(mod.capabilities) ? [...mod.capabilities] : [],
    })),
  }
}

/* ============================== HUD 提示 ============================== */

const NOTICE_STYLE_ID = 'hh-mod-notice-style'
const NOTICE_HOST_ID = 'hh-mod-notice-host'
const MAX_NOTICES = 4

const NOTICE_STYLE = `
#${NOTICE_HOST_ID} {
  position: fixed;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  z-index: 60;
  pointer-events: none;
  font-family: 'HarmonyOS Sans SC', 'Microsoft YaHei', system-ui, sans-serif;
}
#${NOTICE_HOST_ID} .hh-mod-notice {
  padding: 6px 14px;
  font-size: 12px;
  letter-spacing: 0.5px;
  color: #e8eef6;
  background: rgba(6, 10, 15, 0.84);
  border: 1px solid rgba(140, 176, 210, 0.22);
  border-left: 2px solid var(--hh-accent, #f2b544);
  animation: hhModNoticeIn 180ms ease-out;
}
#${NOTICE_HOST_ID} .hh-mod-notice--warn { border-left-color: #ff6a4a; }
#${NOTICE_HOST_ID} .hh-mod-notice--good { border-left-color: #7ce07a; }
@keyframes hhModNoticeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
`

function ensureNoticeHost(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null
  if (!document.getElementById(NOTICE_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = NOTICE_STYLE_ID
    style.textContent = NOTICE_STYLE
    document.head.appendChild(style)
  }
  let host = document.getElementById(NOTICE_HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = NOTICE_HOST_ID
    document.body.appendChild(host)
  }
  return host
}

/** 大厅四角都被面板占满，提示只在对局界面显示；大厅阶段的提示排队到开局 */
function inMatch(): boolean {
  if (typeof document === 'undefined') return false
  return isGameplayActive()
}

const MAX_QUEUED_NOTICES = 3
let queuedNotices: { text: string; options: ModNoticeOptions }[] = []

function renderNotice(text: string, options: ModNoticeOptions = {}): void {
  const host = ensureNoticeHost()
  if (!host) return
  const tone = options.tone === 'warn' || options.tone === 'good' ? options.tone : 'info'
  const duration = Math.min(8000, Math.max(800, options.duration ?? 2600))

  const item = document.createElement('div')
  item.className = `hh-mod-notice${tone === 'info' ? '' : ` hh-mod-notice--${tone}`}`
  // 只用 textContent：Mod 无法通过提示注入 HTML
  item.textContent = text
  host.appendChild(item)
  while (host.childElementCount > MAX_NOTICES) host.firstElementChild?.remove()
  window.setTimeout(() => item.remove(), duration)
}

function showNotice(text: string, options: ModNoticeOptions = {}): void {
  const content = typeof text === 'string' ? text.trim().slice(0, 140) : ''
  if (!content) return
  if (!inMatch()) {
    queuedNotices.push({ text: content, options })
    if (queuedNotices.length > MAX_QUEUED_NOTICES) queuedNotices.shift()
    return
  }
  renderNotice(content, options)
}

function flushQueuedNotices(): void {
  if (queuedNotices.length === 0) return
  const pending = queuedNotices
  queuedNotices = []
  for (const item of pending) renderNotice(item.text, item.options)
}

/* ============================== API 组装 ============================== */

function createScoped(modId: string): HuangHaiModApi {
  return {
    modId,
    registerWeapon: (input) => registerModWeapon(input, modId),
    patchWeapon: (id, patch) => patchModWeapon(id, patch, modId),
    patchBalance: (patch) => {
      const result = setModBalance(modId, patch)
      if (result.ok) bumpModRegistry()
      else recordModDiagnostic(modId, 'balance.patch', result.error ?? '未知错误')
      return { ok: result.ok, error: result.error }
    },
    registerTheme: (theme) => {
      const result = registerModTheme({ ...theme, id: theme.id })
      if (result.ok) bumpModRegistry()
      else recordModDiagnostic(modId, 'theme.register', result.error ?? '未知错误')
      return result
    },
    useTheme: (id) => {
      const result = useModTheme(id)
      if (result.ok) bumpModRegistry()
      else recordModDiagnostic(modId, 'theme.use', result.error ?? '未知错误')
      return result
    },
    on: (event, handler) => {
      if (!(listModEventNames() as string[]).includes(event)) {
        recordModDiagnostic(modId, 'event.on', `未知事件：${event}`)
        return () => {}
      }
      return onModEvent(event, modId, handler)
    },
    off: (event, handler) => offModEvent(event, handler, modId),
    notice: (text, options) => showNotice(text, options),
  }
}

export function createModApi(): HuangHaiApi {
  const scopedByMod = new Map<string, HuangHaiModApi>()

  // 开局时把启动阶段排队的提示补显出来（大厅里没有不遮挡 HUD 的位置）
  onModEvent('match:start', '__game__', flushQueuedNotices)

  const forMod = (modId: string): HuangHaiModApi => {
    const key = typeof modId === 'string' && modId.trim() ? modId.trim() : 'anonymous'
    let scoped = scopedByMod.get(key)
    if (!scoped) {
      scoped = createScoped(key)
      scopedByMod.set(key, scoped)
    }
    return scoped
  }

  const rootScoped = createScoped('anonymous')

  const api: HuangHaiApi = {
    apiVersion: MOD_API_VERSION,
    version: GAME_VERSION,
    events: listModEventNames(),
    get modId() {
      return currentModId()
    },
    forMod,
    registerWeapon: (input) => rootScoped.registerWeapon(input),
    patchWeapon: (id, patch) => rootScoped.patchWeapon(id, patch),
    patchBalance: (patch) => rootScoped.patchBalance(patch),
    registerTheme: (theme) => rootScoped.registerTheme(theme),
    useTheme: (id) => rootScoped.useTheme(id),
    on: (event, handler) => rootScoped.on(event, handler),
    off: (event, handler) => rootScoped.off(event, handler),
    notice: (text, options) => rootScoped.notice(text, options),
    getBalance: () => getModBalance(),
    getWeapons: () => {
      const slots = ['primary', 'secondary', 'melee'] as const
      return slots.flatMap((slot) => weaponsForSlot(slot))
    },
    getThemes: () => listModThemes(),
    getActiveThemeId: () => getActiveModThemeId(),
    getMods: () => describeWorkshop().mods,
    getWorkshop: () => describeWorkshop(),
    getErrors: () => {
      const loaderErrors = (readWorkshop()?.errors ?? []).map((error) => ({
        modId: error.id,
        scope: 'loader',
        message: error.message ?? '脚本加载失败',
        at: Date.now(),
      }))
      return [...loaderErrors, ...listModDiagnostics()]
    },
    __commit: () => {
      bumpModRegistry()
      const info = describeWorkshop()
      const weapons = listModCfWeapons().length
      const themes = listModThemes().length
      const balance = getModBalance()
      if (info.available) {
        console.info(
          `[黄海行动 · 创意工坊] Mod ${info.mods.length} 个 · 新武器 ${weapons} 把 · 主题 ${themes} 套 · 策略 ${info.policy}`,
        )
        if (info.mods.length > 0 && info.policy === 'mods-disabled') {
          console.info('[黄海行动 · 创意工坊] 当前为单人模式，已启用 Mod 不会用于联机。')
        }
      }
      const changed = Object.entries(balance).filter(([, value]) => Math.abs(value - 1) > 0.001)
      if (changed.length > 0) {
        console.info(
          `[黄海行动 · 创意工坊] 数值调整：${changed.map(([key, value]) => `${key}×${value.toFixed(2)}`).join('，')}`,
        )
      }
    },
    __lobbyReady: () => {
      const info = describeWorkshop()
      const payload = {
        modes: MODE_ORDER.map((id: GameModeId) => ({ id, name: GAME_MODES[id].name })),
        modCount: info.mods.length,
      }
      emitModEvent('lobby:ready', payload)
    },
  }

  return api
}

/** 暴露到 window.HuangHai；重复调用返回同一实例 */
export function installModApi(): HuangHaiApi {
  const target = window as unknown as { HuangHai?: HuangHaiApi }
  if (target.HuangHai) return target.HuangHai
  const api = createModApi()
  target.HuangHai = api
  return api
}
