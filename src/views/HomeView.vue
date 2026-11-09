<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import ModeIcon from '@/components/ModeIcon.vue'
import { GAME_MODES, MODE_ORDER } from '@/game/meta'
import { modRegistryVersion } from '@/game/mods/version'
import { CF_LOADOUT_SLOTS, cfWeaponRating, getCfWeapon, weaponsForSlot, type CfSlot } from '@/game/world/cf'
import type { GameModeId, LoadoutChoice } from '@/game/types'
import { useGameStore } from '@/stores/game'

const router = useRouter()
const store = useGameStore()

const mode = ref<GameModeId>(store.lastMode)
const activeSlot = ref<CfSlot>('primary')

const meta = computed(() => GAME_MODES[mode.value])
const modes = MODE_ORDER.map((id) => GAME_MODES[id])

/** 依赖注册表版本，创意工坊运行期新增的武器会自动出现在列表里 */
const slotGroups = computed(() => {
  void modRegistryVersion.value
  return CF_LOADOUT_SLOTS.map((group) => ({
    ...group,
    weapons: weaponsForSlot(group.slot),
  }))
})

interface WorkshopChip {
  mods: number
}

const workshopChip = computed<WorkshopChip | null>(() => {
  void modRegistryVersion.value
  const workshop = window.VibeHubWorkshop
  if (!workshop) return null
  return { mods: workshop.getEnabledMods?.().length ?? 0 }
})

const currentWeapon = computed(() => getCfWeapon(store.loadout[activeSlot.value as keyof LoadoutChoice]))
const rating = computed(() => cfWeaponRating(currentWeapon.value))
const ratingBars = computed(() => [
  { key: 'damage', label: '伤害', value: rating.value.damage },
  { key: 'rate', label: '射速', value: rating.value.rate },
  { key: 'magazine', label: '弹量', value: rating.value.magazine },
  { key: 'accuracy', label: '精度', value: rating.value.accuracy },
  { key: 'control', label: '控枪', value: rating.value.control },
])

const durationText = computed(() => {
  const seconds = meta.value.duration
  if (seconds >= 600) return `${Math.round(seconds / 60)} 分钟`
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
  return `${seconds} 秒`
})

function selectMode(id: GameModeId) {
  mode.value = id
  store.lastMode = id
}

function pickWeapon(id: string) {
  store.setWeapon(activeSlot.value as keyof LoadoutChoice, id)
}

function enterBattle() {
  store.lastMode = mode.value
  void router.push({ name: 'battle', params: { mode: mode.value } })
}
</script>

<template>
  <div class="lobby">
    <div class="lobby__bg" aria-hidden="true">
      <div class="lobby__grid"></div>
      <div class="lobby__glow" :style="{ background: `radial-gradient(circle at 30% 20%, ${meta.accent}33, transparent 60%)` }"></div>
      <div class="lobby__scan"></div>
    </div>

    <header class="topbar">
      <div class="brand">
        <div class="brand__mark">HH</div>
        <div>
          <h1>黄海行动</h1>
          <p>HUANGHAI OPERATIONS · CAMPUS WARFARE</p>
        </div>
      </div>
      <div class="topbar__tags">
        <span v-if="workshopChip" class="workshop-chip" :class="{ 'is-idle': workshopChip.mods === 0 }">
          创意工坊 · {{ workshopChip.mods > 0 ? `${workshopChip.mods} 个 Mod` : '未启用' }}
        </span>
        <span>校园实景 1.2 km²</span>
        <span>5 种模式</span>
        <span>CF 枪械手感</span>
      </div>
    </header>

    <main class="body">
      <section class="modes">
        <div class="section-title">
          <span class="section-title__index">01</span>
          <div>
            <h2>选择作战模式</h2>
            <p>SELECT OPERATION</p>
          </div>
        </div>

        <div class="mode-grid">
          <button
            v-for="(item, index) in modes"
            :key="item.id"
            class="mode-card"
            :class="{ 'is-active': item.id === mode }"
            :style="{ '--accent': item.accent }"
            type="button"
            @click="selectMode(item.id)"
          >
            <span class="mode-card__index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="mode-card__icon"><ModeIcon :icon="item.icon" :size="34" /></span>
            <span class="mode-card__main">
              <strong>{{ item.name }}</strong>
              <em>{{ item.en }}</em>
              <span class="mode-card__tagline">{{ item.tagline }}</span>
            </span>
            <span class="mode-card__arrow" aria-hidden="true">→</span>
          </button>
        </div>

        <div class="loadout">
          <div class="section-title">
            <span class="section-title__index">02</span>
            <div>
              <h2>配枪</h2>
              <p>LOADOUT</p>
            </div>
          </div>

          <div class="loadout__body">
            <div class="loadout__slots">
              <div class="slot-tabs">
                <button
                  v-for="group in slotGroups"
                  :key="group.slot"
                  type="button"
                  class="slot-tab"
                  :class="{ 'is-active': activeSlot === group.slot }"
                  @click="activeSlot = group.slot"
                >
                  {{ group.label }}
                </button>
              </div>
              <div class="weapon-list">
                <button
                  v-for="weapon in slotGroups.find((g) => g.slot === activeSlot)?.weapons ?? []"
                  :key="weapon.id"
                  type="button"
                  class="weapon-chip"
                  :class="{
                    'is-active': store.loadout[activeSlot as keyof LoadoutChoice] === weapon.id,
                    'is-hero': weapon.rarity === 'hero',
                  }"
                  @click="pickWeapon(weapon.id)"
                >
                  <strong>{{ weapon.name }}</strong>
                  <span>{{ weapon.cn }}</span>
                </button>
              </div>
            </div>

            <div class="weapon-detail">
              <div class="weapon-detail__head">
                <div>
                  <h3>{{ currentWeapon.name }}</h3>
                  <p>{{ currentWeapon.cn }} · {{ currentWeapon.tag.toUpperCase() }}</p>
                </div>
                <span class="rarity" :class="`rarity--${currentWeapon.rarity}`">{{ currentWeapon.rarity }}</span>
              </div>
              <p class="weapon-detail__desc">{{ currentWeapon.desc }}</p>
              <div class="rating">
                <div v-for="bar in ratingBars" :key="bar.key" class="rating__row">
                  <span>{{ bar.label }}</span>
                  <div class="rating__track"><i :style="{ width: `${bar.value}%` }"></i></div>
                  <b>{{ bar.value }}</b>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside class="brief" :style="{ '--accent': meta.accent }">
        <div class="brief__head">
          <span class="brief__badge">作战简报</span>
          <span class="brief__en">{{ meta.en }}</span>
        </div>
        <h2 class="brief__name">{{ meta.name }}</h2>
        <p class="brief__tagline">{{ meta.tagline }}</p>
        <p class="brief__desc">{{ meta.description }}</p>

        <ul class="brief__rules">
          <li v-for="rule in meta.rules" :key="rule">
            <span></span>{{ rule }}
          </li>
        </ul>

        <div class="brief__stats">
          <div>
            <span>单局时长</span>
            <strong>{{ durationText }}</strong>
          </div>
          <div>
            <span>战场</span>
            <strong>黄海校区</strong>
          </div>
          <div>
            <span>配枪</span>
            <strong>{{ getCfWeapon(store.loadout.primary).name }} / {{ getCfWeapon(store.loadout.secondary).name }}</strong>
          </div>
        </div>

        <div class="sensitivity">
          <div class="sensitivity__head">
            <span>鼠标灵敏度</span>
            <b>{{ store.sensitivity.toFixed(2) }}×</b>
          </div>
          <input v-model.number="store.sensitivity" type="range" min="0.4" max="2.2" step="0.05" />
        </div>

        <button class="deploy" type="button" @click="enterBattle">
          <span>进入战场</span>
          <em>{{ meta.name }} · DEPLOY</em>
        </button>

        <p class="brief__hint">
          WASD 移动 · Shift 冲刺 · 左键射击 · 右键开镜 · R 换弹 · 1/2/3 切枪 · Esc 暂停
        </p>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.lobby {
  position: relative;
  min-height: 100vh;
  background: #080b10;
  color: #e8eef6;
  overflow-x: hidden;
  font-family: 'HarmonyOS Sans SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.lobby__bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 80% at 50% 0%, #16202e 0%, #0a0d13 45%, #06080c 100%),
    linear-gradient(180deg, rgba(7, 10, 15, 0.2), #06080c 85%);
}

.lobby__grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(120, 170, 220, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 170, 220, 0.06) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(circle at 50% 30%, #000 20%, transparent 78%);
}

.lobby__glow {
  position: absolute;
  inset: 0;
  transition: background 0.5s ease;
  opacity: 0.75;
}

.lobby__scan {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(180deg, rgba(255, 255, 255, 0.022) 0 1px, transparent 1px 4px);
  opacity: 0.5;
}

.topbar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 26px clamp(20px, 4vw, 56px) 18px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 16px;
}

.brand__mark {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  font-weight: 800;
  letter-spacing: 1px;
  color: #0b0f14;
  background: linear-gradient(135deg, #f4c65c, #d89a22);
  clip-path: polygon(14% 0, 100% 0, 100% 86%, 86% 100%, 0 100%, 0 14%);
  font-size: 19px;
}

.brand h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 6px;
  font-weight: 700;
}

.brand p {
  margin: 4px 0 0;
  font-size: 11px;
  letter-spacing: 3px;
  color: #6f8296;
}

.topbar__tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.topbar__tags span {
  font-size: 11px;
  letter-spacing: 1.5px;
  color: #9fb2c6;
  border: 1px solid rgba(140, 176, 210, 0.22);
  background: rgba(16, 24, 34, 0.6);
  padding: 6px 10px;
}

.topbar__tags .workshop-chip {
  color: #ffd8a8;
  border-color: rgba(242, 181, 68, 0.42);
  background: rgba(242, 181, 68, 0.1);
}

.topbar__tags .workshop-chip.is-idle {
  color: #7e93a8;
  border-color: rgba(140, 176, 210, 0.18);
  background: rgba(16, 24, 34, 0.4);
}

.body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: clamp(18px, 2.4vw, 32px);
  padding: 8px clamp(20px, 4vw, 56px) 48px;
  align-items: start;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.section-title__index {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  color: #d8a63c;
  border: 1px solid rgba(216, 166, 60, 0.4);
  padding: 3px 6px;
}

.section-title h2 {
  margin: 0;
  font-size: 15px;
  letter-spacing: 4px;
  font-weight: 600;
}

.section-title p {
  margin: 2px 0 0;
  font-size: 10px;
  letter-spacing: 3px;
  color: #5f7286;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.mode-card {
  position: relative;
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 18px 18px 18px 16px;
  text-align: left;
  color: #dbe6f2;
  background: linear-gradient(120deg, rgba(19, 27, 38, 0.92), rgba(12, 17, 24, 0.86));
  border: 1px solid rgba(120, 156, 190, 0.16);
  clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px));
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.mode-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}

.mode-card.is-active {
  background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 16%, rgba(19, 27, 38, 0.95)), rgba(10, 15, 21, 0.9));
  border-color: color-mix(in srgb, var(--accent) 72%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent), 0 18px 40px -24px var(--accent);
}

.mode-card:last-child {
  grid-column: 1 / -1;
}

.mode-card__index {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: #5f7286;
  align-self: start;
}

.mode-card__icon {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}

.mode-card__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mode-card__main strong {
  font-size: 16px;
  letter-spacing: 2px;
  font-weight: 600;
}

.mode-card__main em {
  font-style: normal;
  font-size: 9px;
  letter-spacing: 3px;
  color: var(--accent);
  opacity: 0.85;
}

.mode-card__tagline {
  margin-top: 6px;
  font-size: 11.5px;
  color: #8fa3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mode-card__arrow {
  color: var(--accent);
  opacity: 0;
  transform: translateX(-6px);
  transition: all 0.18s ease;
}

.mode-card.is-active .mode-card__arrow,
.mode-card:hover .mode-card__arrow {
  opacity: 1;
  transform: translateX(0);
}

.loadout {
  margin-top: 26px;
}

.loadout__body {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
  background: rgba(12, 18, 26, 0.75);
  border: 1px solid rgba(120, 156, 190, 0.14);
}

.slot-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.slot-tab {
  flex: 1;
  padding: 7px 10px;
  font-size: 12px;
  letter-spacing: 2px;
  color: #8fa3b8;
  background: rgba(24, 34, 46, 0.7);
  border: 1px solid rgba(120, 156, 190, 0.16);
  cursor: pointer;
  transition: all 0.15s ease;
}

.slot-tab.is-active {
  color: #0c1015;
  background: linear-gradient(135deg, #f4c65c, #cf9a2c);
  border-color: transparent;
}

.weapon-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 7px;
  max-height: 168px;
  overflow-y: auto;
  padding-right: 4px;
}

.weapon-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  text-align: left;
  background: rgba(20, 29, 40, 0.8);
  border: 1px solid rgba(120, 156, 190, 0.14);
  color: #c8d6e4;
  cursor: pointer;
  transition: all 0.15s ease;
}

.weapon-chip strong {
  font-size: 12px;
  font-weight: 600;
}

.weapon-chip span {
  font-size: 10px;
  color: #7890a6;
}

.weapon-chip.is-active {
  border-color: rgba(244, 198, 92, 0.7);
  background: rgba(244, 198, 92, 0.12);
}

.weapon-chip.is-hero strong {
  color: #f0b429;
}

.weapon-detail__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.weapon-detail__head h3 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 1px;
}

.weapon-detail__head p {
  margin: 3px 0 0;
  font-size: 10px;
  letter-spacing: 2px;
  color: #7890a6;
}

.rarity {
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  padding: 3px 6px;
  border: 1px solid rgba(140, 176, 210, 0.3);
  color: #9fb2c6;
}

.rarity--hero {
  color: #f0b429;
  border-color: rgba(240, 180, 41, 0.6);
}

.weapon-detail__desc {
  margin: 10px 0 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #8fa3b8;
  min-height: 38px;
}

.rating {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rating__row {
  display: grid;
  grid-template-columns: 34px 1fr 26px;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  color: #8fa3b8;
}

.rating__track {
  height: 4px;
  background: rgba(140, 176, 210, 0.14);
  overflow: hidden;
}

.rating__track i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #cf9a2c, #f4c65c);
}

.rating__row b {
  font-weight: 500;
  color: #c8d6e4;
  text-align: right;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.brief {
  position: sticky;
  top: 24px;
  padding: 22px;
  background: linear-gradient(160deg, rgba(18, 26, 36, 0.96), rgba(9, 13, 19, 0.96));
  border: 1px solid color-mix(in srgb, var(--accent) 38%, rgba(120, 156, 190, 0.14));
  clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%);
  box-shadow: 0 30px 80px -50px var(--accent);
}

.brief__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 3px;
  color: #7e93a8;
}

.brief__badge {
  color: var(--accent);
  border-left: 2px solid var(--accent);
  padding-left: 8px;
}

.brief__name {
  margin: 14px 0 4px;
  font-size: 30px;
  letter-spacing: 4px;
  font-weight: 700;
}

.brief__tagline {
  margin: 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--accent);
}

.brief__desc {
  margin: 16px 0;
  font-size: 12.5px;
  line-height: 1.85;
  color: #9db0c4;
}

.brief__rules {
  list-style: none;
  margin: 0 0 18px;
  padding: 14px 0 0;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.brief__rules li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: #b9c8d8;
}

.brief__rules span {
  width: 5px;
  height: 5px;
  background: var(--accent);
  transform: rotate(45deg);
  flex: 0 0 auto;
}

.brief__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 0;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
  border-bottom: 1px dashed rgba(140, 176, 210, 0.2);
}

.brief__stats div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brief__stats span {
  font-size: 9.5px;
  letter-spacing: 2px;
  color: #6f8296;
}

.brief__stats strong {
  font-size: 12px;
  font-weight: 500;
  color: #dbe6f2;
}

.sensitivity {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed rgba(140, 176, 210, 0.2);
}

.sensitivity__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 10px;
  letter-spacing: 2px;
  color: #7e93a8;
  margin-bottom: 8px;
}

.sensitivity__head b {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  color: #dbe6f2;
}

.sensitivity input[type='range'] {
  width: 100%;
  height: 3px;
  appearance: none;
  background: rgba(140, 176, 210, 0.22);
  outline: none;
  cursor: pointer;
}

.sensitivity input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: var(--accent);
  border: none;
  transform: rotate(45deg);
}

.deploy {
  width: 100%;
  margin-top: 20px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: #0b0f14;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 92%, #fff), var(--accent));
  border: none;
  clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
  transition: transform 0.16s ease, filter 0.16s ease;
}

.deploy:hover {
  transform: translateY(-2px);
  filter: brightness(1.08);
}

.deploy span {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 8px;
}

.deploy em {
  font-style: normal;
  font-size: 9px;
  letter-spacing: 3px;
  opacity: 0.72;
}

.brief__hint {
  margin: 14px 0 0;
  font-size: 10.5px;
  line-height: 1.8;
  color: #5f7286;
}

@media (max-width: 1180px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
  }

  .brief {
    position: relative;
    top: 0;
  }
}

@media (max-width: 760px) {
  .mode-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .loadout__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .brief__name {
    font-size: 24px;
  }
}
</style>
