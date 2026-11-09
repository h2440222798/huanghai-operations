<script setup lang="ts">
import { computed } from 'vue'

import type { FeedEntry, MatchHud } from '@/game/types'

const props = defineProps<{
  hud: MatchHud
  feed: FeedEntry[]
  banner: { text: string; sub?: string; tone: 'info' | 'warn' | 'good' } | null
}>()

const clock = computed(() => formatClock(props.hud.remaining))
const spread = computed(() => `${Math.min(46, Math.max(4, props.hud.spreadPx))}px`)
const healthTone = computed(() => (props.hud.health > 60 ? 'ok' : props.hud.health > 30 ? 'warn' : 'danger'))
const allyRatio = computed(() => clamp01(props.hud.allyScore / Math.max(1, props.hud.allyTarget)))
const enemyRatio = computed(() => clamp01(props.hud.enemyScore / Math.max(1, props.hud.allyTarget)))
const planted = computed(() => props.hud.bomb?.state === 'planted')

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const RADAR_RANGE = 130
const RADAR_RADIUS = 60

const radarBlips = computed(() => {
  const yaw = props.hud.playerYaw
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  return props.hud.radar.map((blip, index) => {
    const dx = blip.x - props.hud.playerX
    const dz = blip.z - props.hud.playerZ
    const distance = Math.hypot(dx, dz)
    const screenX = dx * cos - dz * sin
    const screenY = dx * sin + dz * cos
    const clamp = Math.min(distance, RADAR_RANGE) / Math.max(1, distance)
    const scale = RADAR_RADIUS / RADAR_RANGE
    return {
      key: `${blip.kind}-${index}`,
      kind: blip.kind,
      left: 50 + screenX * clamp * scale,
      top: 50 + screenY * clamp * scale,
      near: distance < RADAR_RANGE,
    }
  })
})

function percent(value: number | null | undefined) {
  return `${Math.round(clamp01(value ?? 0) * 100)}%`
}
</script>

<template>
  <div class="hud" :class="{ 'is-zoomed': hud.zoomed }">
    <!-- 顶部比分 -->
    <div class="scorebar">
      <div class="scorebar__side scorebar__side--ally">
        <span class="scorebar__label">{{ hud.allyLabel }}</span>
        <strong>{{ hud.allyScore }}</strong>
        <i class="scorebar__bar"><b :style="{ width: percent(allyRatio) }"></b></i>
      </div>
      <div class="scorebar__clock">
        <span class="scorebar__mode">{{ hud.modeName }}</span>
        <strong>{{ clock }}</strong>
        <span class="scorebar__sub">{{ hud.mode === 'challenge' ? `第 ${hud.wave?.wave ?? 1} 波` : '剩余时间' }}</span>
      </div>
      <div class="scorebar__side scorebar__side--enemy">
        <span class="scorebar__label">{{ hud.enemyLabel }}</span>
        <strong>{{ hud.enemyScore }}</strong>
        <i class="scorebar__bar"><b :style="{ width: percent(enemyRatio) }"></b></i>
      </div>
    </div>

    <!-- 目标面板 -->
    <div class="objective">
      <div class="objective__head">
        <span class="objective__dot"></span>
        <span>{{ hud.objectiveTitle }}</span>
      </div>
      <p class="objective__detail">{{ hud.objectiveDetail }}</p>
      <div v-if="hud.objectiveProgress !== null" class="objective__track">
        <i :style="{ width: percent(hud.objectiveProgress) }"></i>
      </div>
      <div v-if="hud.wave" class="objective__wave">
        <span>场上 {{ hud.wave.enemiesLeft }} 只</span>
        <span v-if="hud.wave.intermission > 0">下一波 {{ Math.ceil(hud.wave.intermission) }}s</span>
      </div>
    </div>

    <!-- 雷达 -->
    <div class="radar">
      <div class="radar__ring radar__ring--outer"></div>
      <div class="radar__ring radar__ring--inner"></div>
      <div class="radar__cross radar__cross--h"></div>
      <div class="radar__cross radar__cross--v"></div>
      <div class="radar__sweep"></div>
      <span
        v-for="blip in radarBlips"
        :key="blip.key"
        class="radar__blip"
        :class="[`radar__blip--${blip.kind}`, { 'is-far': !blip.near }]"
        :style="{ left: `${blip.left}%`, top: `${blip.top}%` }"
      ></span>
      <i class="radar__self"></i>
      <span class="radar__label">RADAR · 130m</span>
    </div>

    <!-- 三角洲据点 -->
    <div v-if="hud.captures" class="captures">
      <div
        v-for="point in hud.captures"
        :key="point.id"
        class="capture"
        :class="[`capture--${point.owner}`, { 'is-inside': point.playerInside }]"
      >
        <div class="capture__id">{{ point.id }}</div>
        <div class="capture__info">
          <span>{{ point.owner === 'ally' ? '蓝方' : point.owner === 'enemy' ? '红方' : '中立' }}</span>
          <i><b :style="{ width: `${point.progress}%` }"></b></i>
        </div>
      </div>
    </div>

    <!-- 爆破状态 -->
    <div v-if="hud.bomb" class="bomb" :class="{ 'is-planted': planted }">
      <template v-if="planted">
        <span class="bomb__tag">C4 已安放 · {{ hud.bomb.site }} 点</span>
        <strong class="bomb__timer">{{ Math.ceil(hud.bomb.timer) }}</strong>
        <div v-if="hud.bomb.defuseProgress > 0.02" class="bomb__defuse">
          <span>敌人正在拆弹</span>
          <i><b :style="{ width: `${Math.round(hud.bomb.defuseProgress * 100)}%` }"></b></i>
        </div>
      </template>
      <template v-else-if="hud.bomb.plantProgress > 0.01">
        <span class="bomb__tag">正在安放 C4</span>
        <div class="bomb__plant">
          <i><b :style="{ width: `${Math.round(hud.bomb.plantProgress * 100)}%` }"></b></i>
        </div>
      </template>
      <template v-else>
        <span class="bomb__hint">{{ hud.bomb.inSite ? '按住 E 安放 C4' : '前往 A / B 爆破点' }}</span>
      </template>
    </div>

    <!-- 击杀信息 -->
    <div class="feed">
      <div v-for="entry in feed" :key="entry.id" class="feed__item" :class="`feed__item--${entry.kind}`">
        {{ entry.text }}
      </div>
    </div>

    <!-- 连杀 -->
    <div v-if="hud.streak >= 2" class="streak">
      <strong>{{ hud.streakLabel }}</strong>
      <span>×{{ hud.streak }}</span>
      <i><b :style="{ width: `${Math.round(hud.streakRemaining * 100)}%` }"></b></i>
    </div>

    <!-- 大局播报 -->
    <div v-if="banner" class="banner" :class="`banner--${banner.tone}`">
      <strong>{{ banner.text }}</strong>
      <span v-if="banner.sub">{{ banner.sub }}</span>
    </div>

    <!-- 准星 -->
    <div class="crosshair" :style="{ '--spread': spread }">
      <i class="crosshair__line crosshair__line--t"></i>
      <i class="crosshair__line crosshair__line--b"></i>
      <i class="crosshair__line crosshair__line--l"></i>
      <i class="crosshair__line crosshair__line--r"></i>
      <i class="crosshair__dot"></i>
      <i class="crosshair__hit" :class="{ 'is-head': hud.headshotMarker > 0 }" :style="{ opacity: hud.hitMarker > 0 ? 1 : 0 }"></i>
    </div>

    <!-- 开镜 -->
    <div v-if="hud.zoomed" class="scope">
      <div class="scope__ring"></div>
      <i class="scope__h"></i>
      <i class="scope__v"></i>
    </div>

    <!-- 生命 / 护甲 -->
    <div class="vitals" :class="`vitals--${healthTone}`">
      <div class="vitals__row">
        <span class="vitals__icon">HP</span>
        <div class="vitals__track"><i :style="{ width: `${hud.health}%` }"></i></div>
        <strong>{{ hud.health }}</strong>
      </div>
      <div class="vitals__row vitals__row--armor">
        <span class="vitals__icon">AR</span>
        <div class="vitals__track"><i :style="{ width: `${hud.armor}%` }"></i></div>
        <strong>{{ hud.armor }}</strong>
      </div>
      <div class="vitals__meta">
        <span>{{ hud.kills }} 击杀</span>
        <span>{{ hud.accuracy }}% 命中</span>
        <span>{{ hud.score }} 分</span>
      </div>
    </div>

    <!-- 武器 -->
    <div class="weapon" :class="{ 'is-low': hud.lowAmmo, 'is-reloading': hud.reloading }">
      <div class="weapon__name">
        <strong>{{ hud.weaponCn }}</strong>
        <span>{{ hud.weaponName }} · {{ hud.slot === 'primary' ? '主武器' : hud.slot === 'secondary' ? '副武器' : '近战' }}</span>
      </div>
      <div class="weapon__ammo">
        <strong>{{ hud.slot === 'melee' ? '—' : hud.ammo }}</strong>
        <span v-if="hud.slot !== 'melee'">/ {{ hud.reserve }}</span>
      </div>
      <div class="weapon__mag">
        <i v-for="n in Math.min(30, Math.max(6, Math.round(hud.magazineSize / 2)))" :key="n"
           :class="{ 'is-spent': n > Math.ceil((hud.ammo / Math.max(1, hud.magazineSize)) * Math.min(30, Math.max(6, Math.round(hud.magazineSize / 2)))) }"></i>
      </div>
      <div v-if="hud.reloading" class="weapon__reload">
        <span>换弹中</span>
        <i><b :style="{ width: `${Math.round(hud.reloadProgress * 100)}%` }"></b></i>
      </div>
      <div v-else-if="hud.lowAmmo" class="weapon__warn">弹药不足 · 按 R 换弹</div>
      <div class="weapon__slots">
        <span :class="{ 'is-on': hud.slot === 'primary' }">1 主</span>
        <span :class="{ 'is-on': hud.slot === 'secondary' }">2 副</span>
        <span :class="{ 'is-on': hud.slot === 'melee' }">3 近</span>
      </div>
    </div>

    <!-- 阵亡 -->
    <div v-if="hud.dead" class="dead">
      <strong>你被击杀</strong>
      <span>{{ Math.ceil(hud.respawnIn) }} 秒后复活</span>
    </div>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'HarmonyOS Sans SC', 'Microsoft YaHei', system-ui, sans-serif;
  color: #e8eef6;
  --accent: #f2b544;
}

.scorebar {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: stretch;
  gap: 10px;
  padding: 6px 10px;
  background: linear-gradient(180deg, rgba(6, 10, 15, 0.82), rgba(6, 10, 15, 0.55));
  border: 1px solid rgba(140, 176, 210, 0.16);
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px));
  backdrop-filter: blur(6px);
  min-width: 460px;
}

.scorebar__side {
  display: grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto auto;
  align-items: center;
  gap: 2px 8px;
  min-width: 118px;
}

.scorebar__side--enemy {
  text-align: right;
  direction: rtl;
}

.scorebar__label {
  font-size: 10px;
  letter-spacing: 2px;
  color: #8fa3b8;
  grid-column: 1;
}

.scorebar__side strong {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 24px;
  line-height: 1;
  color: #7fc4ff;
}

.scorebar__side--enemy strong {
  color: #ff8071;
}

.scorebar__bar {
  grid-column: 1 / -1;
  display: block;
  height: 3px;
  background: rgba(140, 176, 210, 0.18);
  overflow: hidden;
}

.scorebar__bar b {
  display: block;
  height: 100%;
  background: #57a9ff;
  transition: width 0.3s ease;
}

.scorebar__side--enemy .scorebar__bar b {
  background: #ff6a58;
  margin-left: auto;
}

.scorebar__clock {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  border-left: 1px solid rgba(140, 176, 210, 0.16);
  border-right: 1px solid rgba(140, 176, 210, 0.16);
}

.scorebar__clock strong {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 26px;
  letter-spacing: 2px;
  line-height: 1.1;
}

.scorebar__mode {
  font-size: 9px;
  letter-spacing: 3px;
  color: var(--accent);
}

.scorebar__sub {
  font-size: 9px;
  letter-spacing: 1px;
  color: #6f8296;
}

.objective {
  position: absolute;
  top: 16px;
  left: 18px;
  width: 268px;
  padding: 12px 14px;
  background: linear-gradient(120deg, rgba(8, 12, 18, 0.86), rgba(8, 12, 18, 0.5));
  border-left: 2px solid var(--accent);
  backdrop-filter: blur(6px);
}

.objective__head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  letter-spacing: 1.5px;
  color: #e8eef6;
}

.objective__dot {
  width: 6px;
  height: 6px;
  background: var(--accent);
  transform: rotate(45deg);
  flex: 0 0 auto;
}

.objective__detail {
  margin: 7px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: #93a8bd;
}

.objective__track {
  margin-top: 9px;
  height: 3px;
  background: rgba(140, 176, 210, 0.18);
  overflow: hidden;
}

.objective__track i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.25s ease;
}

.objective__wave {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 10px;
  color: #7890a6;
}

.radar {
  position: absolute;
  top: 126px;
  left: 18px;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(10, 18, 26, 0.85), rgba(6, 10, 15, 0.55));
  border: 1px solid rgba(140, 176, 210, 0.22);
  overflow: hidden;
  backdrop-filter: blur(4px);
}

.radar__ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(120, 170, 210, 0.16);
  border-radius: 50%;
}

.radar__ring--outer {
  width: 84%;
  height: 84%;
}

.radar__ring--inner {
  width: 44%;
  height: 44%;
}

.radar__cross {
  position: absolute;
  background: rgba(120, 170, 210, 0.14);
}

.radar__cross--h {
  left: 8%;
  right: 8%;
  top: 50%;
  height: 1px;
}

.radar__cross--v {
  top: 8%;
  bottom: 8%;
  left: 50%;
  width: 1px;
}

.radar__sweep {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 50%;
  height: 50%;
  transform-origin: 0 0;
  background: conic-gradient(from 0deg, rgba(120, 210, 255, 0.16), transparent 42%);
  animation: radarSweep 4.2s linear infinite;
  pointer-events: none;
}

@keyframes radarSweep {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.radar__blip {
  position: absolute;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  box-shadow: 0 0 6px currentColor;
  background: currentColor;
}

.radar__blip--enemy { color: #ff5a4d; }
.radar__blip--ally { color: #4da3ff; }
.radar__blip--objective { color: #f2c05c; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 1px; }
.radar__blip--bomb { color: #ff8a3c; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; }

.radar__blip.is-far {
  opacity: 0.45;
}

.radar__self {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  margin: -6px 0 0 -5px;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 11px solid #e8f2ff;
  filter: drop-shadow(0 0 4px rgba(140, 210, 255, 0.8));
}

.radar__label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: 8px;
  letter-spacing: 1.5px;
  color: rgba(150, 180, 205, 0.7);
}

.captures {
  position: absolute;
  top: 130px;
  right: 18px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.capture {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 150px;
  padding: 6px 8px;
  background: rgba(8, 12, 18, 0.82);
  border: 1px solid rgba(140, 176, 210, 0.18);
  transition: border-color 0.2s ease;
}

.capture--ally {
  border-color: rgba(77, 163, 255, 0.7);
}

.capture--enemy {
  border-color: rgba(255, 90, 77, 0.7);
}

.capture.is-inside {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25) inset;
}

.capture__id {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  background: rgba(140, 176, 210, 0.12);
}

.capture--ally .capture__id {
  background: rgba(77, 163, 255, 0.24);
  color: #8fc9ff;
}

.capture--enemy .capture__id {
  background: rgba(255, 90, 77, 0.24);
  color: #ff9c92;
}

.capture__info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 9.5px;
  color: #9db0c4;
}

.capture__info i {
  display: block;
  height: 3px;
  background: rgba(140, 176, 210, 0.18);
}

.capture__info b {
  display: block;
  height: 100%;
  background: #9aa7b4;
  transition: width 0.2s linear;
}

.capture--ally .capture__info b {
  background: #4da3ff;
}

.capture--enemy .capture__info b {
  background: #ff5a4d;
}

.bomb {
  position: absolute;
  top: 92px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 8px 18px;
  background: rgba(8, 12, 18, 0.78);
  border: 1px solid rgba(255, 138, 60, 0.45);
  min-width: 240px;
}

.bomb.is-planted {
  border-color: #ff5a3c;
  background: rgba(40, 8, 6, 0.85);
  animation: bombPulse 1s infinite;
}

@keyframes bombPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 90, 60, 0); }
  50% { box-shadow: 0 0 26px 0 rgba(255, 90, 60, 0.45); }
}

.bomb__tag {
  font-size: 10px;
  letter-spacing: 2px;
  color: #ffb08a;
}

.bomb__timer {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 34px;
  line-height: 1;
  color: #ff6a4a;
}

.bomb__hint {
  font-size: 11px;
  letter-spacing: 1px;
  color: #c8d6e4;
}

.bomb__plant,
.bomb__defuse i {
  width: 180px;
  height: 5px;
  background: rgba(255, 255, 255, 0.14);
  display: block;
}

.bomb__plant i,
.bomb__defuse b {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #ffb066, #ff5a3c);
  transition: width 0.1s linear;
}

.bomb__defuse {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #ff8f7a;
}

.feed {
  position: absolute;
  top: 16px;
  right: 18px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  max-width: 340px;
}

.feed__item {
  font-size: 11.5px;
  padding: 5px 9px;
  background: rgba(8, 12, 18, 0.72);
  border-right: 2px solid rgba(140, 176, 210, 0.4);
  color: #c8d6e4;
  animation: feedIn 0.18s ease;
}

@keyframes feedIn {
  from { opacity: 0; transform: translateX(10px); }
  to { opacity: 1; transform: translateX(0); }
}

.feed__item--kill { border-right-color: #f2b544; }
.feed__item--headshot { border-right-color: #ff5a3c; color: #ffd7c9; }
.feed__item--streak { border-right-color: #ff7ad9; color: #ffc9ef; }
.feed__item--warn { border-right-color: #ff5a4d; color: #ffb4ac; }
.feed__item--pickup { border-right-color: #6fe08a; color: #b8f0c6; }
.feed__item--objective { border-right-color: #6fb7ff; color: #c6e2ff; }

.streak {
  position: absolute;
  top: 30%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 10px;
  text-align: center;
  animation: streakIn 0.2s ease;
}

.streak strong {
  font-size: 30px;
  letter-spacing: 6px;
  color: #ffd76a;
  text-shadow: 0 0 24px rgba(255, 190, 60, 0.6);
}

.streak span {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 18px;
  color: #ff9b5c;
}

.streak i {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -8px;
  height: 3px;
  background: rgba(255, 215, 106, 0.2);
}

.streak b {
  display: block;
  height: 100%;
  background: #ffd76a;
}

@keyframes streakIn {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.banner {
  position: absolute;
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
  animation: bannerIn 0.22s ease;
}

.banner strong {
  font-size: 30px;
  letter-spacing: 8px;
  text-shadow: 0 4px 30px rgba(0, 0, 0, 0.8);
}

.banner span {
  font-size: 12px;
  letter-spacing: 3px;
  color: #c8d6e4;
}

.banner--warn strong { color: #ff7a5c; }
.banner--good strong { color: #7ce07a; }
.banner--info strong { color: #f2d08a; }

@keyframes bannerIn {
  from { opacity: 0; transform: translate(-50%, -12px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
}

.crosshair__line {
  position: absolute;
  background: rgba(230, 244, 255, 0.88);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
}

.crosshair__line--t,
.crosshair__line--b {
  width: 2px;
  height: 8px;
  left: -1px;
}

.crosshair__line--l,
.crosshair__line--r {
  width: 8px;
  height: 2px;
  top: -1px;
}

.crosshair__line--t { top: calc(-1 * var(--spread) - 8px); }
.crosshair__line--b { top: var(--spread); }
.crosshair__line--l { left: calc(-1 * var(--spread) - 8px); }
.crosshair__line--r { left: var(--spread); }

.crosshair__dot {
  position: absolute;
  width: 2px;
  height: 2px;
  left: -1px;
  top: -1px;
  background: #fff;
}

.crosshair__hit {
  position: absolute;
  inset: -12px;
  transition: opacity 0.1s linear;
}

.crosshair__hit::before,
.crosshair__hit::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 22px;
  height: 2px;
  background: #ff5a3c;
  transform: translate(-50%, -50%) rotate(45deg);
}

.crosshair__hit::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.crosshair__hit.is-head::before,
.crosshair__hit.is-head::after {
  background: #ffd76a;
  box-shadow: 0 0 8px rgba(255, 215, 106, 0.9);
}

.scope {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, transparent 0 33vh, rgba(0, 0, 0, 0.94) 33.4vh);
}

.scope__ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 66vh;
  height: 66vh;
  transform: translate(-50%, -50%);
  border: 2px solid rgba(0, 0, 0, 0.9);
  border-radius: 50%;
  box-shadow: inset 0 0 60px rgba(0, 0, 0, 0.7);
}

.scope__h,
.scope__v {
  position: absolute;
  background: rgba(0, 0, 0, 0.85);
}

.scope__h {
  left: 50%;
  top: 50%;
  width: 66vh;
  height: 1px;
  transform: translate(-50%, -50%);
}

.scope__v {
  left: 50%;
  top: 50%;
  width: 1px;
  height: 66vh;
  transform: translate(-50%, -50%);
}

.vitals {
  position: absolute;
  left: 18px;
  bottom: 18px;
  width: 232px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  background: linear-gradient(120deg, rgba(8, 12, 18, 0.85), rgba(8, 12, 18, 0.5));
  border-left: 2px solid #6fe08a;
  backdrop-filter: blur(6px);
}

.vitals--warn { border-left-color: #f2b544; }
.vitals--danger { border-left-color: #ff5a4d; }

.vitals__row {
  display: grid;
  grid-template-columns: 26px 1fr 34px;
  align-items: center;
  gap: 8px;
}

.vitals__icon {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 9px;
  letter-spacing: 1px;
  color: #8fa3b8;
}

.vitals__track {
  height: 7px;
  background: rgba(140, 176, 210, 0.16);
  overflow: hidden;
}

.vitals__track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #4bcf7c, #7ce07a);
  transition: width 0.18s ease;
}

.vitals--warn .vitals__track i { background: linear-gradient(90deg, #d89a22, #f2d06a); }
.vitals--danger .vitals__track i { background: linear-gradient(90deg, #c03020, #ff6a4a); }

.vitals__row--armor .vitals__track i {
  background: linear-gradient(90deg, #3b7fd4, #6fb7ff);
}

.vitals__row strong {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 15px;
  text-align: right;
}

.vitals__meta {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  padding-top: 7px;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
  font-size: 9.5px;
  color: #7890a6;
}

.weapon {
  position: absolute;
  right: 18px;
  bottom: 18px;
  width: 268px;
  padding: 12px 14px;
  background: linear-gradient(240deg, rgba(8, 12, 18, 0.86), rgba(8, 12, 18, 0.52));
  border-right: 2px solid var(--accent);
  backdrop-filter: blur(6px);
  text-align: right;
}

.weapon__name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.weapon__name strong {
  font-size: 15px;
  letter-spacing: 2px;
}

.weapon__name span {
  font-size: 9px;
  letter-spacing: 2px;
  color: #7890a6;
}

.weapon__ammo {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}

.weapon__ammo strong {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 34px;
  line-height: 1;
  color: #f5e6c8;
}

.weapon__ammo span {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  color: #8fa3b8;
}

.weapon.is-low .weapon__ammo strong {
  color: #ff6a4a;
  animation: lowAmmo 0.9s infinite;
}

@keyframes lowAmmo {
  50% { opacity: 0.45; }
}

.weapon__mag {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 7px;
}

.weapon__mag i {
  width: 3px;
  height: 9px;
  background: #f2b544;
}

.weapon__mag i.is-spent {
  background: rgba(140, 176, 210, 0.2);
}

.weapon__reload,
.weapon__warn {
  margin-top: 8px;
  font-size: 10px;
  color: #f2b544;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.weapon__reload i {
  width: 100%;
  height: 3px;
  background: rgba(140, 176, 210, 0.18);
}

.weapon__reload b {
  display: block;
  height: 100%;
  background: #f2b544;
}

.weapon__warn {
  color: #ff6a4a;
}

.weapon__slots {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
  font-size: 9.5px;
  color: #6f8296;
}

.weapon__slots .is-on {
  color: #f2b544;
}

.dead {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(20, 2, 2, 0.45);
}

.dead strong {
  font-size: 34px;
  letter-spacing: 10px;
  color: #ff6a5a;
}

.dead span {
  font-size: 12px;
  letter-spacing: 3px;
  color: #ffb4ac;
}

.hud.is-zoomed .crosshair {
  opacity: 0;
}
</style>
