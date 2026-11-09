import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import type { GameModeId, LoadoutChoice } from '@/game/types'

const STORAGE_KEY = 'huanghai-battlefield/v1'

interface Persisted {
  loadout: LoadoutChoice
  lastMode: GameModeId
  sensitivity: number
}

function readStorage(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Partial<Persisted>
  } catch {
    return {}
  }
}

export const useGameStore = defineStore('game', () => {
  const saved = readStorage()

  const loadout = ref<LoadoutChoice>(
    saved.loadout ?? { primary: 'ak47', secondary: 'deagle', melee: 'kukri' },
  )
  const lastMode = ref<GameModeId>(saved.lastMode ?? 'classic')
  const sensitivity = ref(saved.sensitivity ?? 1)

  watch(
    [loadout, lastMode, sensitivity],
    () => {
      const payload: Persisted = {
        loadout: loadout.value,
        lastMode: lastMode.value,
        sensitivity: sensitivity.value,
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // 隐私模式下 localStorage 不可写，忽略即可
      }
    },
    { deep: true },
  )

  function setWeapon(slot: keyof LoadoutChoice, id: string) {
    loadout.value = { ...loadout.value, [slot]: id }
  }

  return { loadout, lastMode, sensitivity, setWeapon }
})
