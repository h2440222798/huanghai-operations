<script setup lang="ts">
import type { GameModeMeta } from '@/game/types'

const props = defineProps<{ icon: GameModeMeta['icon']; size?: number }>()
const size = props.size ?? 30
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="icon === 'swords'">
      <path d="M5 27l6-6M27 5l-9 9M27 5h-5M27 5v5M5 27h5M5 27v-5" />
      <path d="M9 9l14 14M23 9L9 23" opacity=".55" />
    </template>
    <template v-else-if="icon === 'bomb'">
      <circle cx="14" cy="19" r="7.5" />
      <path d="M19.5 13.5l3-3M22 10.5l3 3M22.5 8.5l1-3M17 6.5h5" />
      <circle cx="27" cy="7" r="1.8" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="icon === 'biohazard'">
      <circle cx="16" cy="16" r="2.4" />
      <path d="M16 13.6c0-4.2-1.4-7.2-4-8.4 2.6-2.4 8-2.4 10.6 0-2.6 1.2-4 4.2-4 8.4" />
      <path d="M13.9 17.2c-3.6 2.2-5.2 5.2-4.4 8.2-3.4-.8-6-5.2-6-8.6 2.5.6 5.2-.6 7.2-3" />
      <path d="M18.1 17.2c3.6 2.2 5.2 5.2 4.4 8.2 3.4-.8 6-5.2 6-8.6-2.5.6-5.2-.6-7.2-3" />
    </template>
    <template v-else-if="icon === 'target'">
      <circle cx="16" cy="16" r="10.5" />
      <circle cx="16" cy="16" r="5.5" />
      <circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none" />
      <path d="M16 1.5v5M16 25.5v5M1.5 16h5M25.5 16h5" />
    </template>
    <template v-else>
      <path d="M4 9l6-3 5 3 4-3 9 4v17l-9-4-4 3-5-3-6 3z" />
      <path d="M10 6v19M19 9v17" opacity=".6" />
      <circle cx="15" cy="15" r="2.6" fill="currentColor" stroke="none" opacity=".8" />
    </template>
  </svg>
</template>
