import * as THREE from 'three'

import { createFbm2d, createRandom } from './math'
import type { GroundTheme, ParticleTheme } from './types'

function canvas2d(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  return { canvas, ctx, size }
}

function finish(canvas: HTMLCanvasElement, mirrored = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  if (mirrored) {
    texture.wrapS = THREE.MirroredRepeatWrapping
    texture.wrapT = THREE.MirroredRepeatWrapping
  }
  return texture
}

/** 法线/粗糙度等数据贴图必须使用线性色彩空间 */
function finishLinear(canvas: HTMLCanvasElement, mirrored = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.anisotropy = 8
  if (mirrored) {
    texture.wrapS = THREE.MirroredRepeatWrapping
    texture.wrapT = THREE.MirroredRepeatWrapping
  }
  return texture
}

function luminanceField(image: ImageData, size: number) {
  const field = new Float32Array(size * size)
  for (let i = 0; i < size * size; i += 1) {
    field[i] = (image.data[i * 4]! * 0.2126 + image.data[i * 4 + 1]! * 0.7152 + image.data[i * 4 + 2]! * 0.0722) / 255
  }
  return field
}

function normalTextureFromField(field: Float32Array, size: number, strength: number) {
  const { canvas, ctx } = canvas2d(size)
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
  const { canvas, ctx } = canvas2d(size)
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

const GROUND_ROUGHNESS: Record<GroundTheme['style'], { base: number; variation: number; normal: number }> = {
  rock: { base: 0.92, variation: 0.2, normal: 1.8 },
  ice: { base: 0.28, variation: 0.32, normal: 0.85 },
  desert: { base: 0.94, variation: 0.16, normal: 1.2 },
  lava: { base: 0.78, variation: 0.26, normal: 1.5 },
  cloud: { base: 0.84, variation: 0.14, normal: 0.6 },
  toxic: { base: 0.58, variation: 0.3, normal: 1.0 },
  ruin: { base: 0.88, variation: 0.2, normal: 1.4 },
}

/* ---------------- 地表贴图 ---------------- */

export interface GroundMaps {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
  normalScale: number
  emissiveMap?: THREE.CanvasTexture
  emissiveColor?: string
  emissiveIntensity?: number
}

/**
 * 按天体风格生成可平铺的地表贴图。
 * 反照率与自发光分开绘制：熔岩裂缝、毒雾水洼与云带会自发光。
 */
export function makeGroundMaps(theme: GroundTheme, seed = 7): GroundMaps {
  const size = 384
  const { canvas, ctx } = canvas2d(size)
  const emissiveCanvas = document.createElement('canvas')
  emissiveCanvas.width = size
  emissiveCanvas.height = size
  const ectx = emissiveCanvas.getContext('2d')!
  const rng = createRandom(seed)
  const fbm = createFbm2d(seed, 4)

  ctx.fillStyle = theme.base
  ctx.fillRect(0, 0, size, size)
  ectx.fillStyle = '#000000'
  ectx.fillRect(0, 0, size, size)

  // 大尺度斑块（两种明暗）
  for (let i = 0; i < 90; i += 1) {
    const x = rng.next() * size
    const y = rng.next() * size
    const r = 16 + rng.next() * 90
    const tone = fbm(x / 90, y / 90)
    const color = tone > 0.5 ? theme.light : theme.dark
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `${color}${tone > 0.5 ? '44' : '55'}`)
    grad.addColorStop(1, `${color}00`)
    ctx.fillStyle = grad
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // 细节颗粒
  for (let i = 0; i < 5200; i += 1) {
    const x = rng.next() * size
    const y = rng.next() * size
    const light = rng.next() > 0.5
    ctx.fillStyle = `${light ? theme.light : theme.dark}${Math.floor(30 + rng.next() * 90).toString(16).padStart(2, '0')}`
    ctx.fillRect(x, y, 1 + rng.next() * 2, 1 + rng.next() * 2)
  }

  let emissiveColor: string | undefined

  if (theme.style === 'lava') {
    emissiveColor = '#ff6a1a'
    // 岩浆裂缝：随机游走的发光枝干
    const drawCrack = (x: number, y: number, angle: number, length: number, width: number, depth: number) => {
      if (depth <= 0 || length < 6) return
      let px = x
      let py = y
      let a = angle
      ectx.beginPath()
      ectx.moveTo(px, py)
      const steps = Math.max(3, Math.floor(length / 6))
      for (let s = 0; s < steps; s += 1) {
        a += (rng.next() - 0.5) * 0.9
        px += Math.cos(a) * (length / steps)
        py += Math.sin(a) * (length / steps)
        ectx.lineTo(px, py)
      }
      ectx.lineCap = 'round'
      ectx.strokeStyle = `rgba(255,${120 + rng.next() * 90 | 0},40,${0.5 + rng.next() * 0.5})`
      ectx.lineWidth = width
      ectx.stroke()
      ectx.strokeStyle = 'rgba(255,230,150,.85)'
      ectx.lineWidth = Math.max(1, width * 0.35)
      ectx.stroke()
      if (rng.next() > 0.35) drawCrack(px, py, a + 0.8, length * 0.55, width * 0.7, depth - 1)
      if (rng.next() > 0.35) drawCrack(px, py, a - 0.8, length * 0.55, width * 0.7, depth - 1)
    }
    for (let i = 0; i < 16; i += 1) drawCrack(rng.next() * size, rng.next() * size, rng.next() * Math.PI * 2, 60 + rng.next() * 90, 2 + rng.next() * 3, 3)
  } else if (theme.style === 'ice') {
    // 冰裂纹
    for (let i = 0; i < 46; i += 1) {
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + rng.next() * 0.3})`
      ctx.lineWidth = 0.7 + rng.next() * 1.6
      ctx.beginPath()
      let x = rng.next() * size
      let y = rng.next() * size
      let a = rng.next() * Math.PI * 2
      ctx.moveTo(x, y)
      for (let s = 0; s < 7; s += 1) {
        a += (rng.next() - 0.5) * 1.4
        x += Math.cos(a) * (12 + rng.next() * 34)
        y += Math.sin(a) * (12 + rng.next() * 34)
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    for (let i = 0; i < 500; i += 1) {
      const x = rng.next() * size
      const y = rng.next() * size
      ctx.fillStyle = `rgba(255,255,255,${0.3 + rng.next() * 0.6})`
      ctx.fillRect(x, y, 1.5, 1.5)
    }
  } else if (theme.style === 'desert') {
    // 风蚀波纹
    for (let i = 0; i < 120; i += 1) {
      const y = (i / 120) * size
      ctx.beginPath()
      ctx.moveTo(0, y)
      for (let x = 0; x <= size; x += 8) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + i * 0.7) * 4 + Math.sin(x * 0.05 + i) * 1.6)
      }
      ctx.strokeStyle = `rgba(${i % 2 ? '255,225,190' : '90,40,20'},${0.05 + rng.next() * 0.07})`
      ctx.lineWidth = 1 + rng.next() * 2
      ctx.stroke()
    }
  } else if (theme.style === 'cloud') {
    // 气态巨行星云带 + 涡旋
    ectx.fillStyle = '#000000'
    for (let i = 0; i < 26; i += 1) {
      const y = rng.next() * size
      const h = 4 + rng.next() * 26
      const grad = ctx.createLinearGradient(0, y, 0, y + h)
      grad.addColorStop(0, `${theme.light}55`)
      grad.addColorStop(0.5, `${theme.base}33`)
      grad.addColorStop(1, `${theme.dark}44`)
      ctx.fillStyle = grad
      ctx.fillRect(0, y, size, h)
      ectx.fillStyle = `rgba(255,${170 + rng.next() * 60 | 0},${90 + rng.next() * 80 | 0},${0.06 + rng.next() * 0.1})`
      ectx.fillRect(0, y, size, h)
    }
    for (let i = 0; i < 22; i += 1) {
      const x = rng.next() * size
      const y = rng.next() * size
      const rx = 12 + rng.next() * 44
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate((rng.next() - 0.5) * 0.5)
      ctx.fillStyle = `rgba(255,240,210,${0.05 + rng.next() * 0.1})`
      ctx.beginPath()
      ctx.ellipse(0, 0, rx, rx * 0.22, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    emissiveColor = '#ffb066'
  } else if (theme.style === 'toxic') {
    emissiveColor = '#c8d84a'
    // 酸液水洼
    for (let i = 0; i < 30; i += 1) {
      const x = rng.next() * size
      const y = rng.next() * size
      const r = 8 + rng.next() * 34
      ctx.fillStyle = `rgba(150,150,40,${0.16 + rng.next() * 0.2})`
      ctx.beginPath()
      ctx.ellipse(x, y, r, r * (0.5 + rng.next() * 0.5), rng.next() * 3, 0, Math.PI * 2)
      ctx.fill()
      ectx.fillStyle = `rgba(200,220,70,${0.2 + rng.next() * 0.3})`
      ectx.beginPath()
      ectx.ellipse(x, y, r * 0.8, r * 0.4, rng.next() * 3, 0, Math.PI * 2)
      ectx.fill()
    }
  } else if (theme.style === 'ruin') {
    // 沥青裂缝 + 苔藓
    for (let i = 0; i < 34; i += 1) {
      ctx.strokeStyle = `rgba(10,14,10,${0.35 + rng.next() * 0.4})`
      ctx.lineWidth = 1 + rng.next() * 2.4
      ctx.beginPath()
      let x = rng.next() * size
      let y = rng.next() * size
      ctx.moveTo(x, y)
      for (let s = 0; s < 5; s += 1) {
        x += (rng.next() - 0.5) * 80
        y += (rng.next() - 0.5) * 80
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    for (let i = 0; i < 40; i += 1) {
      const x = rng.next() * size
      const y = rng.next() * size
      const r = 6 + rng.next() * 30
      ctx.fillStyle = `rgba(120,150,90,${0.05 + rng.next() * 0.14})`
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    // 岩石：陨石坑
    for (let i = 0; i < theme.craters; i += 1) {
      const x = rng.next() * size
      const y = rng.next() * size
      const r = 4 + rng.next() * 22
      const grad = ctx.createRadialGradient(x, y, r * 0.15, x, y, r)
      grad.addColorStop(0, 'rgba(0,0,0,.32)')
      grad.addColorStop(0.7, 'rgba(0,0,0,.12)')
      grad.addColorStop(1, 'rgba(255,255,255,.1)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  const map = finish(canvas)
  const field = luminanceField(ctx.getImageData(0, 0, size, size), size)
  // 法线/粗糙度用半分辨率即可：视觉细节足够，同时把生成耗时降到 1/4
  const detailSize = size / 2
  const detailField = new Float32Array(detailSize * detailSize)
  for (let y = 0; y < detailSize; y += 1) {
    for (let x = 0; x < detailSize; x += 1) {
      detailField[y * detailSize + x] = field[(y * 2) * size + x * 2]!
    }
  }
  const settings = GROUND_ROUGHNESS[theme.style]
  const normalMap = normalTextureFromField(detailField, detailSize, settings.normal)
  const roughnessMap = roughnessTextureFromField(detailField, detailSize, settings.base, settings.variation)
  map.anisotropy = 16
  normalMap.anisotropy = 16
  roughnessMap.anisotropy = 16
  const result: GroundMaps = {
    map,
    normalMap,
    roughnessMap,
    normalScale: settings.normal,
  }
  if (emissiveColor) {
    const emissiveMap = finish(emissiveCanvas)
    emissiveMap.colorSpace = THREE.SRGBColorSpace
    result.emissiveMap = emissiveMap
    result.emissiveColor = emissiveColor
    result.emissiveIntensity = theme.style === 'lava' ? 1.35 : theme.style === 'cloud' ? 0.35 : 0.55
  }
  return result
}

function hexColor(color: string) {
  try {
    return `#${new THREE.Color(color).getHexString()}`
  } catch {
    return '#ffffff'
  }
}

/* ---------------- 精灵贴图 ---------------- */

/** 柔光圆盘（太阳、月光、能量核心） */
export function makeSoftDisc(color: string, inner = 0.85) {
  const base = hexColor(color)
  const { canvas, ctx, size } = canvas2d(128)
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grad.addColorStop(0, `rgba(255,255,255,${Math.min(1, inner + 0.15)})`)
  grad.addColorStop(0.18, `${base}ee`)
  grad.addColorStop(0.52, `${base}66`)
  grad.addColorStop(1, `${base}00`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return finish(canvas, false)
}

/** 雨滴 / 流线粒子 */
export function makeStreak(color: string) {
  const base = hexColor(color)
  const { canvas, ctx } = canvas2d(32)
  const grad = ctx.createLinearGradient(16, 0, 16, 32)
  grad.addColorStop(0, `${base}00`)
  grad.addColorStop(0.45, `${base}99`)
  grad.addColorStop(1, `${base}ff`)
  ctx.strokeStyle = grad
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.moveTo(16, 1)
  ctx.lineTo(16, 31)
  ctx.stroke()
  return finish(canvas, false)
}

/** 粒子用的柔和光点 */
export function makeParticle(color: string, soft = false) {
  const base = hexColor(color)
  const { canvas, ctx, size } = canvas2d(64)
  if (soft) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, `${base}ff`)
    grad.addColorStop(0.4, `${base}88`)
    grad.addColorStop(1, `${base}00`)
    ctx.fillStyle = grad
  } else {
    ctx.fillStyle = base
  }
  ctx.fillRect(0, 0, size, size)
  return finish(canvas, false)
}

/** 气态行星的云带横幅 */
export function makeBandStrip(color: string) {
  const base = hexColor(color)
  const { canvas, ctx, size } = canvas2d(512)
  const rng = createRandom(31)
  for (let i = 0; i < 18; i += 1) {
    const y = rng.next() * size
    const h = 6 + rng.next() * 40
    const alpha = 0.06 + rng.next() * 0.16
    const grad = ctx.createLinearGradient(0, y, 0, y + h)
    grad.addColorStop(0, `${base}00`)
    grad.addColorStop(0.5, `${base}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`)
    grad.addColorStop(1, `${base}00`)
    ctx.fillStyle = grad
    ctx.fillRect(0, y, size, h)
  }
  return finish(canvas, false)
}

/** 冲击波圆环（径向渐变，中间透明） */
export function makeShockRing(color: string) {
  const { canvas, ctx, size } = canvas2d(256)
  const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.5)
  grad.addColorStop(0, `${color}00`)
  grad.addColorStop(0.65, `${color}55`)
  grad.addColorStop(0.92, `${color}dd`)
  grad.addColorStop(1, `${color}00`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return finish(canvas, false)
}

/** 行星/卫星圆盘：边缘清晰，避免月亮看起来像一团光晕 */
export function makePlanetDisc(color: string, shade = '#9aa4ac') {
  const { canvas, ctx, size } = canvas2d(128)
  const center = size / 2
  const radius = size * 0.46
  const gradient = ctx.createRadialGradient(center - radius * 0.3, center - radius * 0.3, radius * 0.1, center, center, radius)
  gradient.addColorStop(0, color)
  gradient.addColorStop(0.72, color)
  gradient.addColorStop(1, shade)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(center, center, radius, 0, Math.PI * 2)
  ctx.fill()
  // 极轻微的陨石坑斑驳
  const rng = createRandom(11)
  for (let i = 0; i < 14; i += 1) {
    const angle = rng.next() * Math.PI * 2
    const distance = rng.next() * radius * 0.82
    const r = radius * (0.03 + rng.next() * 0.08)
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rng.next() * 0.08})`
    ctx.beginPath()
    ctx.arc(center + Math.cos(angle) * distance, center + Math.sin(angle) * distance, r, 0, Math.PI * 2)
    ctx.fill()
  }
  return finish(canvas, false)
}

/** 血条用的白色圆角矩形 */
export function makeBarTexture() {
  const { canvas, ctx, size } = canvas2d(64)
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(0, size * 0.28, size, size * 0.44, size * 0.2)
    ctx.fill()
  } else {
    ctx.fillRect(0, size * 0.28, size, size * 0.44)
  }
  return finish(canvas, false)
}

/** 粒子场贴图选择 */
export function particleTexture(theme: ParticleTheme) {
  if (theme.kind === 'rain') return makeStreak(theme.color)
  if (theme.kind === 'spark') return makeParticle(theme.color, true)
  return makeParticle(theme.color, false)
}
