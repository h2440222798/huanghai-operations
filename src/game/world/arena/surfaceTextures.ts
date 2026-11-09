import * as THREE from 'three'

import { createRandom } from './math'

/**
 * 轻量级程序化 PBR 表面贴图。
 * 只生成一次并全局缓存；使用 256² 画布 + 画布图形而非逐像素噪声，避免首次进入战场时卡顿。
 */
export type SurfaceKind =
  | 'rock'
  | 'metal'
  | 'concrete'
  | 'wood'
  | 'ice'
  | 'armor'
  | 'gunmetal'
  | 'polymer'

export interface SurfaceMaps {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  normalScale: number
}

interface SurfaceSettings {
  seed: number
  base: number
  roughness: number
  roughnessVar: number
  normal: number
}

const SETTINGS: Record<SurfaceKind, SurfaceSettings> = {
  rock: { seed: 11, base: 0.8, roughness: 0.92, roughnessVar: 0.18, normal: 1.8 },
  metal: { seed: 23, base: 0.84, roughness: 0.34, roughnessVar: 0.22, normal: 1.05 },
  concrete: { seed: 37, base: 0.8, roughness: 0.88, roughnessVar: 0.16, normal: 1.4 },
  wood: { seed: 43, base: 0.78, roughness: 0.74, roughnessVar: 0.14, normal: 1.2 },
  ice: { seed: 59, base: 0.94, roughness: 0.2, roughnessVar: 0.24, normal: 0.9 },
  armor: { seed: 67, base: 0.72, roughness: 0.5, roughnessVar: 0.2, normal: 1.1 },
  gunmetal: { seed: 79, base: 0.82, roughness: 0.32, roughnessVar: 0.22, normal: 0.85 },
  polymer: { seed: 83, base: 0.7, roughness: 0.64, roughnessVar: 0.14, normal: 0.75 },
}

const CACHE = new Map<SurfaceKind, SurfaceMaps>()
const SIZE = 192

export function surfaceMaps(kind: SurfaceKind): SurfaceMaps {
  const cached = CACHE.get(kind)
  if (cached) return cached

  const settings = SETTINGS[kind]
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = SIZE
  heightCanvas.height = SIZE
  const hctx = heightCanvas.getContext('2d')!
  const rng = createRandom(settings.seed)
  const base = Math.round(settings.base * 255)
  ctx.fillStyle = `rgb(${base},${base},${base})`
  ctx.fillRect(0, 0, SIZE, SIZE)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, SIZE, SIZE)

  // 大尺度斑驳：同时写入反照率与高度
  for (let i = 0; i < 150; i += 1) {
    const x = rng.next() * SIZE
    const y = rng.next() * SIZE
    const radius = 4 + rng.next() * 34
    const light = rng.next() > 0.5
    const tone = light ? 255 : 0
    const alpha = 0.04 + rng.next() * 0.09
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(${tone},${tone},${tone},${alpha})`)
    gradient.addColorStop(1, `rgba(${tone},${tone},${tone},0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    const hGradient = hctx.createRadialGradient(x, y, 0, x, y, radius)
    hGradient.addColorStop(0, `rgba(${light ? 255 : 0},${light ? 255 : 0},${light ? 255 : 0},${alpha * 1.6})`)
    hGradient.addColorStop(1, `rgba(${light ? 255 : 0},${light ? 255 : 0},${light ? 255 : 0},0)`)
    hctx.fillStyle = hGradient
    hctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  // 细节颗粒
  for (let i = 0; i < 2600; i += 1) {
    const x = rng.next() * SIZE
    const y = rng.next() * SIZE
    const light = rng.next() > 0.5
    const alpha = 0.05 + rng.next() * 0.14
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`
    ctx.fillRect(x, y, 1 + rng.next() * 1.6, 1 + rng.next() * 1.6)
    hctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`
    hctx.fillRect(x, y, 1 + rng.next() * 1.6, 1 + rng.next() * 1.6)
  }

  const stroke = (
    target: CanvasRenderingContext2D,
    color: string,
    width: number,
    points: [number, number][],
  ) => {
    target.strokeStyle = color
    target.lineWidth = width
    target.lineCap = 'round'
    target.beginPath()
    points.forEach(([x, y], index) => (index === 0 ? target.moveTo(x, y) : target.lineTo(x, y)))
    target.stroke()
  }

  if (kind === 'rock' || kind === 'ice') {
    for (let i = 0; i < (kind === 'ice' ? 140 : 240); i += 1) {
      const x = rng.next() * SIZE
      const y = rng.next() * SIZE
      const r = 1.5 + rng.next() * (kind === 'ice' ? 4 : 8)
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
      gradient.addColorStop(0, `rgba(0,0,0,${0.18 + rng.next() * 0.2})`)
      gradient.addColorStop(0.72, 'rgba(0,0,0,.08)')
      gradient.addColorStop(1, 'rgba(255,255,255,.08)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      hctx.fillStyle = 'rgba(0,0,0,.35)'
      hctx.beginPath()
      hctx.arc(x, y, r, 0, Math.PI * 2)
      hctx.fill()
    }
    for (let i = 0; i < (kind === 'ice' ? 28 : 14); i += 1) {
      const points: [number, number][] = []
      let x = rng.next() * SIZE
      let y = rng.next() * SIZE
      let angle = rng.next() * Math.PI * 2
      for (let s = 0; s < 7; s += 1) {
        angle += (rng.next() - 0.5) * 1.2
        x += Math.cos(angle) * (8 + rng.next() * 22)
        y += Math.sin(angle) * (8 + rng.next() * 22)
        points.push([x, y])
      }
      stroke(ctx, kind === 'ice' ? 'rgba(240,252,255,.32)' : 'rgba(18,16,14,.32)', 0.9, points)
      stroke(hctx, 'rgba(0,0,0,.38)', 0.9, points)
    }
  } else if (kind === 'metal' || kind === 'gunmetal') {
    for (let i = 0; i < 600; i += 1) {
      const x = rng.next() * SIZE
      const y = rng.next() * SIZE
      const length = 8 + rng.next() * 42
      const light = rng.next() > 0.55
      ctx.strokeStyle = light ? 'rgba(255,255,255,.1)' : 'rgba(15,18,20,.15)'
      ctx.lineWidth = 0.6 + rng.next() * 0.8
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + length, y + (rng.next() - 0.5) * 1.4)
      ctx.stroke()
      hctx.strokeStyle = light ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.14)'
      hctx.lineWidth = 0.7
      hctx.beginPath()
      hctx.moveTo(x, y)
      hctx.lineTo(x + length, y)
      hctx.stroke()
    }
    for (let i = 0; i < 30; i += 1) {
      const points: [number, number][] = []
      let x = rng.next() * SIZE
      let y = rng.next() * SIZE
      let angle = rng.next() * Math.PI * 2
      for (let s = 0; s < 4; s += 1) {
        angle += (rng.next() - 0.5) * 0.5
        x += Math.cos(angle) * (8 + rng.next() * 28)
        y += Math.sin(angle) * (8 + rng.next() * 28)
        points.push([x, y])
      }
      stroke(ctx, 'rgba(250,252,255,.32)', 0.7, points)
      stroke(hctx, 'rgba(255,255,255,.2)', 0.7, points)
    }
  } else if (kind === 'concrete') {
    for (let i = 0; i < 12; i += 1) {
      const points: [number, number][] = []
      let x = rng.next() * SIZE
      let y = rng.next() * SIZE
      for (let s = 0; s < 5; s += 1) {
        x += (rng.next() - 0.5) * 46
        y += (rng.next() - 0.5) * 46
        points.push([x, y])
      }
      stroke(ctx, 'rgba(24,24,22,.3)', 0.7 + rng.next() * 0.7, points)
      stroke(hctx, 'rgba(0,0,0,.35)', 0.8, points)
    }
  } else if (kind === 'wood') {
    for (let i = 0; i < 56; i += 1) {
      const baseY = rng.next() * SIZE
      const points: [number, number][] = []
      for (let x = 0; x <= SIZE; x += 8) {
        points.push([x, baseY + Math.sin(x * 0.04 + i * 0.6) * (2 + rng.next() * 1.5)])
      }
      stroke(ctx, 'rgba(35,22,12,.3)', 0.7 + rng.next() * 1.1, points)
      stroke(hctx, 'rgba(0,0,0,.32)', 0.9, points)
    }
    for (let i = 0; i < 5; i += 1) {
      const x = rng.next() * SIZE
      const y = rng.next() * SIZE
      for (let ring = 0; ring < 4; ring += 1) {
        ctx.strokeStyle = `rgba(30,18,10,${0.18 - ring * 0.03})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(x, y, 3 + ring * 4, 1.6 + ring * 2.2, 0.4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  } else if (kind === 'armor') {
    for (let i = 0; i <= SIZE; i += 48) {
      stroke(ctx, 'rgba(0,0,0,.42)', 1.8, [[i, 0], [i, SIZE]])
      stroke(ctx, 'rgba(255,255,255,.07)', 1, [[i + 2, 0], [i + 2, SIZE]])
      stroke(hctx, 'rgba(0,0,0,.45)', 1.8, [[i, 0], [i, SIZE]])
    }
    for (let x = 0; x < SIZE; x += 48) {
      for (let y = 0; y < SIZE; y += 48) {
        ctx.fillStyle = 'rgba(225,230,235,.2)'
        ctx.beginPath()
        ctx.arc(x + 9, y + 9, 1.8, 0, Math.PI * 2)
        ctx.fill()
        hctx.fillStyle = 'rgba(255,255,255,.24)'
        hctx.beginPath()
        hctx.arc(x + 9, y + 9, 1.8, 0, Math.PI * 2)
        hctx.fill()
      }
    }
    for (let i = 0; i < 40; i += 1) {
      const x = rng.next() * SIZE
      const y = rng.next() * SIZE
      stroke(ctx, `rgba(235,240,245,${0.2 + rng.next() * 0.2})`, 0.6, [[x, y], [x + 6 + rng.next() * 24, y + (rng.next() - 0.5) * 6]])
    }
  } else if (kind === 'polymer') {
    for (let i = 0; i < 2400; i += 1) {
      const x = rng.next() * SIZE
      const y = rng.next() * SIZE
      const light = rng.next() > 0.5
      ctx.fillStyle = light ? 'rgba(215,220,225,.14)' : 'rgba(20,22,24,.14)'
      ctx.fillRect(x, y, 1, 1)
      hctx.fillStyle = light ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)'
      hctx.fillRect(x, y, 1, 1)
    }
  }

  const field = luminanceField(hctx.getImageData(0, 0, SIZE, SIZE), SIZE)
  const map = finish(canvas)
  const normalMap = normalTextureFromField(field, SIZE, settings.normal)
  const roughnessMap = roughnessTextureFromField(field, SIZE, settings.roughness, settings.roughnessVar)
  const result: SurfaceMaps = { map, normalMap, roughnessMap, normalScale: settings.normal }
  CACHE.set(kind, result)
  return result
}

function luminanceField(image: ImageData, size: number) {
  const field = new Float32Array(size * size)
  for (let i = 0; i < size * size; i += 1) {
    field[i] = (image.data[i * 4]! * 0.2126 + image.data[i * 4 + 1]! * 0.7152 + image.data[i * 4 + 2]! * 0.0722) / 255
  }
  return field
}

function normalTextureFromField(field: Float32Array, size: number, strength: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  const at = (x: number, y: number) => field[((y + size) % size) * size + ((x + size) % size)]!
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength
      const length = Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      image.data[i] = ((nx / length) * 0.5 + 0.5) * 255
      image.data[i + 1] = ((ny / length) * 0.5 + 0.5) * 255
      image.data[i + 2] = (1 / length) * 255
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return finishLinear(canvas)
}

function roughnessTextureFromField(field: Float32Array, size: number, base: number, variation: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i += 1) {
    const value = Math.min(1, Math.max(0.04, base + (0.5 - field[i]!) * variation))
    const byte = Math.round(value * 255)
    image.data[i * 4] = byte
    image.data[i * 4 + 1] = byte
    image.data[i * 4 + 2] = byte
    image.data[i * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return finishLinear(canvas)
}

function finish(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.userData.sharedSurface = true
  return texture
}

function finishLinear(canvas: HTMLCanvasElement) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.anisotropy = 8
  texture.userData.sharedSurface = true
  return texture
}
