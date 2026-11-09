/**
 * 创意工坊「HUD 主题」注册表。
 *
 * 只开放一组 CSS 变量，不接收任意 CSS 文本，避免 Mod 用样式覆盖游戏界面、
 * 遮挡按钮或伪造平台信息。
 */

export interface ModTheme {
  /** 全局唯一 ID，建议形如 `作者.主题名` */
  id: string
  name: string
  /** HUD 主色，例如 #ff7a4d */
  accent: string
  /** 危险 / 低血量提示色，可选 */
  danger?: string
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** 允许写入的 CSS 变量与取值来源 */
const THEME_VARS: { key: keyof Pick<ModTheme, 'accent' | 'danger'>; cssVar: string }[] = [
  { key: 'accent', cssVar: '--hh-accent' },
  { key: 'danger', cssVar: '--hh-danger' },
]

const themes = new Map<string, ModTheme>()
let activeThemeId: string | null = null

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim())
}

export interface ThemeResult {
  ok: boolean
  error?: string
}

export function registerModTheme(theme: ModTheme): ThemeResult {
  if (themes.has(theme.id)) return { ok: false, error: `主题 ID 已被占用：${theme.id}` }
  if (!isHexColor(theme.accent)) return { ok: false, error: 'accent 必须是 #RGB 或 #RRGGBB' }
  if (theme.danger !== undefined && !isHexColor(theme.danger)) {
    return { ok: false, error: 'danger 必须是 #RGB 或 #RRGGBB' }
  }
  themes.set(theme.id, { ...theme })
  // 第一个注册的主题自动生效，保证「装了就有效果」；后续主题需要显式 useTheme
  if (!activeThemeId) applyModTheme(theme.id)
  return { ok: true }
}

function applyModTheme(id: string | null): void {
  const theme = id ? themes.get(id) : null
  const root = document.documentElement
  for (const { key, cssVar } of THEME_VARS) {
    const value = theme?.[key]
    if (value) root.style.setProperty(cssVar, value)
    else root.style.removeProperty(cssVar)
  }
}

/** 切换当前主题；传 null 恢复游戏默认配色 */
export function useModTheme(id: string | null): ThemeResult {
  if (id !== null && !themes.has(id)) return { ok: false, error: `未注册的主题：${id}` }
  activeThemeId = id
  applyModTheme(id)
  return { ok: true }
}

export function listModThemes(): ModTheme[] {
  return [...themes.values()].map((theme) => ({ ...theme }))
}

export function getActiveModThemeId(): string | null {
  return activeThemeId
}
