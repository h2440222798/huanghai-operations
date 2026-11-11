<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import GameHud from '@/components/GameHud.vue'
import ModeIcon from '@/components/ModeIcon.vue'
import { GAME_MODES } from '@/game/meta'
import type { MatchEngine } from '@/game/match'
import { setGameplayActive } from '@/game/mods/context'
import type { FeedEntry, FeedKind, GameModeId, MatchHud, MatchResult } from '@/game/types'
import { getCfWeapon } from '@/game/world/cf'
import { CampusApp } from '@/game/world/three/campus'
import { useGameStore } from '@/stores/game'

const route = useRoute()
const router = useRouter()
const store = useGameStore()

const mode = computed<GameModeId>(() => {
  const value = String(route.params.mode ?? 'classic') as GameModeId
  return value in GAME_MODES ? value : 'classic'
})
const meta = computed(() => GAME_MODES[mode.value])

const container = ref<HTMLDivElement | null>(null)
const appRef = shallowRef<CampusApp | null>(null)
const matchRef = shallowRef<MatchEngine | null>(null)
const hud = ref<MatchHud | null>(null)
const feed = ref<FeedEntry[]>([])
const banner = ref<{ text: string; sub?: string; tone: 'info' | 'warn' | 'good' } | null>(null)
const result = ref<MatchResult | null>(null)
const damageFlash = ref(false)
const loading = ref(true)
const fatal = ref('')

let feedId = 0
let bannerTimer = 0
let damageTimer = 0

const phase = computed(() => hud.value?.phase ?? 'briefing')
const showBriefing = computed(() => !result.value && (phase.value === 'briefing' || !hud.value))
const loot = computed(() => ({
  primary: getCfWeapon(store.loadout.primary),
  secondary: getCfWeapon(store.loadout.secondary),
  melee: getCfWeapon(store.loadout.melee),
}))

function pushFeed(text: string, kind: FeedKind) {
  feedId += 1
  const entry: FeedEntry = { id: feedId, text, kind }
  feed.value = [entry, ...feed.value].slice(0, 6)
  window.setTimeout(() => {
    feed.value = feed.value.filter((item) => item.id !== entry.id)
  }, 5200)
}

function requestLock() {
  const canvas = container.value?.querySelector('canvas')
  if (!canvas) return
  const tryLock = (retried: boolean) => {
    try {
      const request = canvas.requestPointerLock() as unknown as Promise<void> | undefined
      if (request && typeof request.catch === 'function') {
        request.catch(() => {
          // Chrome 在 Esc 解锁后 1.25s 内禁止重锁：稍后重试一次，仍失败就等玩家点画面
          if (!retried) window.setTimeout(() => tryLock(true), 1400)
        })
      }
    } catch {
      if (!retried) window.setTimeout(() => tryLock(true), 1400)
    }
  }
  tryLock(false)
}

async function bootstrap() {
  if (!container.value) return
  loading.value = true
  await nextTick()
  try {
    const app = new CampusApp(container.value, {})
    app.setAutoTime(false)
    app.setTimeOfDay(17.62)
    app.setSensitivity(store.sensitivity)
    appRef.value = app
    const match = app.startMatch(
      mode.value,
      {
        onHud: (state) => {
          hud.value = state
        },
        onFeed: pushFeed,
        onBanner: (text, sub, tone = 'info') => {
          banner.value = { text, sub, tone }
          window.clearTimeout(bannerTimer)
          bannerTimer = window.setTimeout(() => (banner.value = null), 2400)
        },
        onDamage: () => {
          damageFlash.value = true
          window.clearTimeout(damageTimer)
          damageTimer = window.setTimeout(() => (damageFlash.value = false), 180)
        },
        onEnd: (summary) => {
          result.value = summary
          if (document.pointerLockElement) document.exitPointerLock()
        },
        requestLock,
      },
      store.loadout,
    )
    matchRef.value = match
    loading.value = false
  } catch (error) {
    console.error(error)
    fatal.value = error instanceof Error ? error.message : '场景初始化失败'
    loading.value = false
  }
}

function beginBattle() {
  matchRef.value?.begin()
}

function resumeBattle() {
  matchRef.value?.begin()
}

function teardown() {
  window.clearTimeout(bannerTimer)
  window.clearTimeout(damageTimer)
  if (document.pointerLockElement) document.exitPointerLock()
  appRef.value?.stopMatch()
  appRef.value?.dispose()
  appRef.value = null
  matchRef.value = null
}

function exitToLobby() {
  teardown()
  void router.push({ name: 'lobby' })
}

async function restart() {
  result.value = null
  hud.value = null
  feed.value = []
  banner.value = null
  teardown()
  await nextTick()
  await bootstrap()
}

onMounted(() => {
  setGameplayActive(true)
  void bootstrap()
})

onBeforeUnmount(() => {
  setGameplayActive(false)
  teardown()
})

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m} 分 ${String(s).padStart(2, '0')} 秒`
}
</script>

<template>
  <div class="battle" @contextmenu.prevent>
    <div ref="container" class="battle__canvas"></div>

    <div v-if="damageFlash" class="damage"></div>

    <GameHud v-if="hud && !showBriefing" :hud="hud" :feed="feed" :banner="banner" />

    <!-- 简报 -->
    <div v-if="showBriefing" class="overlay briefing" :style="{ '--accent': meta.accent }">
      <div class="briefing__panel">
        <div class="briefing__top">
          <span class="briefing__tag">作战简报</span>
          <span class="briefing__en">{{ meta.en }}</span>
        </div>
        <div class="briefing__title">
          <ModeIcon :icon="meta.icon" :size="46" />
          <div>
            <h1>{{ meta.name }}</h1>
            <p>{{ meta.tagline }}</p>
          </div>
        </div>
        <p class="briefing__desc">{{ meta.description }}</p>
        <ul class="briefing__rules">
          <li v-for="rule in meta.rules" :key="rule"><span></span>{{ rule }}</li>
        </ul>
        <div class="briefing__loot">
          <div><span>主武器</span><strong>{{ loot.primary.name }}</strong></div>
          <div><span>副武器</span><strong>{{ loot.secondary.name }}</strong></div>
          <div><span>近战</span><strong>{{ loot.melee.name }}</strong></div>
        </div>
        <button class="cta" type="button" :disabled="loading" @click="beginBattle">
          {{ loading ? '正在部署校园战场…' : '开始战斗' }}
        </button>
        <button class="ghost" type="button" @click="exitToLobby">返回大厅</button>
        <p class="briefing__hint">点击开始后会锁定鼠标 · Esc 暂停</p>
      </div>
    </div>

    <!-- 暂停 -->
    <div v-if="phase === 'paused' && !result" class="overlay">
      <div class="panel">
        <span class="panel__tag">已暂停</span>
        <h2>战术暂停</h2>
        <p class="panel__text">指针已释放。点击继续返回战场，或退出到大厅重新配枪。</p>
        <button class="cta" type="button" @click="resumeBattle">继续战斗</button>
        <button class="ghost" type="button" @click="exitToLobby">退出对局</button>
      </div>
    </div>

    <!-- 结算 -->
    <div v-if="result" class="overlay" :class="{ 'overlay--win': result.victory }">
      <div class="panel panel--result">
        <span class="panel__tag">{{ result.victory ? 'MISSION COMPLETE' : 'MISSION FAILED' }}</span>
        <h2 :class="{ 'is-win': result.victory }">{{ result.victory ? '作战胜利' : '作战失败' }}</h2>
        <p class="panel__text">{{ result.detail }}</p>

        <div class="score">
          <div>
            <span>总得分</span>
            <strong>{{ result.score }}</strong>
          </div>
          <div>
            <span>击杀</span>
            <strong>{{ result.kills }}</strong>
          </div>
          <div>
            <span>爆头</span>
            <strong>{{ result.headshots }}</strong>
          </div>
          <div>
            <span>命中率</span>
            <strong>{{ result.accuracy }}%</strong>
          </div>
        </div>

        <ul class="lines">
          <li v-for="line in result.lines" :key="line.label">
            <span>{{ line.label }}</span>
            <b>{{ line.value }}</b>
          </li>
          <li><span>用时</span><b>{{ formatTime(result.time) }}</b></li>
        </ul>

        <button class="cta" type="button" @click="restart">再来一局</button>
        <button class="ghost" type="button" @click="exitToLobby">返回大厅</button>
      </div>
    </div>

    <!-- 异常 -->
    <div v-if="fatal" class="overlay">
      <div class="panel">
        <span class="panel__tag">启动失败</span>
        <h2>无法进入战场</h2>
        <p class="panel__text">{{ fatal }}</p>
        <button class="ghost" type="button" @click="exitToLobby">返回大厅</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.battle {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #05070a;
  color: #e8eef6;
  font-family: 'HarmonyOS Sans SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.battle__canvas {
  position: absolute;
  inset: 0;
}

.battle__canvas :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}

.damage {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at center, transparent 35%, rgba(190, 20, 10, 0.55) 100%);
  animation: damageIn 0.18s ease-out;
}

@keyframes damageIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(circle at 50% 40%, rgba(8, 12, 18, 0.72), rgba(3, 5, 8, 0.94));
  backdrop-filter: blur(3px);
  z-index: 10;
}

.overlay--win {
  background: radial-gradient(circle at 50% 40%, rgba(30, 40, 20, 0.55), rgba(3, 5, 8, 0.94));
}

.briefing__panel,
.panel {
  width: min(560px, 100%);
  padding: 26px 28px;
  background: linear-gradient(160deg, rgba(18, 26, 36, 0.97), rgba(8, 12, 18, 0.97));
  border: 1px solid color-mix(in srgb, var(--accent, #f2b544) 42%, rgba(120, 156, 190, 0.14));
  clip-path: polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 0 100%);
  box-shadow: 0 40px 90px -60px var(--accent, #f2b544);
}

.briefing__top {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 3px;
  color: #7e93a8;
}

.briefing__tag {
  color: var(--accent);
  border-left: 2px solid var(--accent);
  padding-left: 8px;
}

.briefing__title {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 16px 0 12px;
  color: var(--accent);
}

.briefing__title h1 {
  margin: 0;
  font-size: 28px;
  letter-spacing: 5px;
  color: #eef4fb;
}

.briefing__title p {
  margin: 4px 0 0;
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--accent);
}

.briefing__desc {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.85;
  color: #9db0c4;
}

.briefing__rules {
  list-style: none;
  margin: 0 0 16px;
  padding: 12px 0 0;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
}

.briefing__rules li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #b9c8d8;
}

.briefing__rules span {
  width: 5px;
  height: 5px;
  background: var(--accent);
  transform: rotate(45deg);
  flex: 0 0 auto;
}

.briefing__loot {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px 0;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
}

.briefing__loot div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.briefing__loot span {
  font-size: 9px;
  letter-spacing: 2px;
  color: #6f8296;
}

.briefing__loot strong {
  font-size: 12.5px;
  font-weight: 500;
}

.cta {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 6px;
  color: #0b0f14;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent, #f2b544) 90%, #fff), var(--accent, #f2b544));
  border: none;
  cursor: pointer;
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
  transition: transform 0.15s ease, filter 0.15s ease;
}

.cta:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.08);
}

.cta:disabled {
  cursor: default;
  filter: grayscale(0.4);
}

.ghost {
  width: 100%;
  margin-top: 8px;
  padding: 11px;
  font-size: 12px;
  letter-spacing: 4px;
  color: #9db0c4;
  background: transparent;
  border: 1px solid rgba(140, 176, 210, 0.28);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ghost:hover {
  color: #e8eef6;
  border-color: rgba(140, 176, 210, 0.6);
}

.briefing__hint {
  margin: 12px 0 0;
  text-align: center;
  font-size: 10px;
  letter-spacing: 1.5px;
  color: #5f7286;
}

.panel h2 {
  margin: 10px 0 8px;
  font-size: 30px;
  letter-spacing: 8px;
}

.panel h2.is-win {
  color: #8ce08a;
}

.panel__tag {
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--accent, #f2b544);
  border-left: 2px solid var(--accent, #f2b544);
  padding-left: 8px;
}

.panel__text {
  margin: 0 0 14px;
  font-size: 12.5px;
  line-height: 1.8;
  color: #9db0c4;
}

.score {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 14px 0;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
  border-bottom: 1px dashed rgba(140, 176, 210, 0.2);
}

.score div {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.score span {
  font-size: 9px;
  letter-spacing: 2px;
  color: #6f8296;
}

.score strong {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 22px;
}

.lines {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.lines li {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #9db0c4;
}

.lines b {
  font-weight: 500;
  color: #dbe6f2;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

@media (max-width: 640px) {
  .briefing__rules {
    grid-template-columns: 1fr;
  }

  .score {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
