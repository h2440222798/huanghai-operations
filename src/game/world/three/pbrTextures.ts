import * as THREE from 'three'

import {
  colorTexture,
  createCanvas,
  dataTexture,
  fbm,
  grain,
  normalMapFromHeight,
  ormTexture,
  seededRandom,
  wrappedCircle,
} from './procedural'

/**
 * 校园场景的程序化 PBR 贴图库。
 *
 * 每一类表面都输出「颜色 + 法线 + ORM」三张贴图：
 * - 颜色贴图 sRGB，包含真实的砖缝 / 瓷砖缝 / 沥青骨料 / 草地斑驳；
 * - 法线贴图由高度图求导生成，让窗户凹进墙体、砖缝凹陷、铺装凸起；
 * - ORM 打包贴图（G=粗糙度，B=金属度），玻璃光滑、石材粗糙、铝框金属，
 *   配合 PMREM 环境反射，同一盏太阳下能看出完全不同的材质性格。
 */

export type SurfaceKind =
  | 'grass'
  | 'asphalt'
  | 'paver'
  | 'plaza'
  | 'roof'
  | 'stone'
  | 'bark'
  | 'leaf'
  | 'wood'
  | 'metal'
  | 'sand'
  | 'track'

export interface SurfaceSet {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  orm: THREE.CanvasTexture
  normalScale: number
}

const SURFACE_CACHE = new Map<SurfaceKind, SurfaceSet>()

/** 取某类表面的 PBR 贴图组（结果缓存，整场景共享） */
export function surfaceMaps(kind: SurfaceKind): SurfaceSet {
  const cached = SURFACE_CACHE.get(kind)
  if (cached) return cached
  const set = buildSurface(kind)
  SURFACE_CACHE.set(kind, set)
  return set
}

/* ------------------------------ 表面构建 ------------------------------ */

function buildSurface(kind: SurfaceKind): SurfaceSet {
  switch (kind) {
    case 'grass':
      return grassSurface()
    case 'asphalt':
      return asphaltSurface()
    case 'paver':
      return paverSurface()
    case 'plaza':
      return plazaSurface()
    case 'roof':
      return roofSurface()
    case 'stone':
      return stoneSurface()
    case 'bark':
      return barkSurface()
    case 'leaf':
      return leafSurface()
    case 'wood':
      return woodSurface()
    case 'metal':
      return metalSurface()
    case 'sand':
      return sandSurface()
    case 'track':
      return trackSurface()
  }
}

/** 灰度高度图 → Float32 高度场（用于生成法线） */
function heightField(ctx: CanvasRenderingContext2D, size: number) {
  const image = ctx.getImageData(0, 0, size, size)
  const field = new Float32Array(size * size)
  for (let i = 0; i < size * size; i++) {
    const p = i * 4
    field[i] =
      ((image.data[p] ?? 0) * 0.2126 +
        (image.data[p + 1] ?? 0) * 0.7152 +
        (image.data[p + 2] ?? 0) * 0.0722) /
      255
  }
  return field
}

function finishSurface(
  albedo: HTMLCanvasElement,
  heightCanvas: HTMLCanvasElement,
  size: number,
  normalStrength: number,
  rough: number,
  metal: number,
  variation: number,
  seed = 17,
): SurfaceSet {
  const hctx = heightCanvas.getContext('2d')!
  const field = heightField(hctx, size)
  return {
    map: colorTexture(albedo),
    normalMap: normalMapFromHeight(field, size, normalStrength),
    orm: ormTexture(size, { roughness: rough, metalness: metal, variation, seed }),
    normalScale: normalStrength * 0.5,
  }
}

/* ------------------------------ 草地 ------------------------------ */

function grassSurface(): SurfaceSet {
  const size = 768
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(20240901)

  // 底色用多尺度噪声：远看得见草坪的深浅块，近看有草叶碎屑
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const ny = y / size
      const clump = fbm(nx, ny, 11, 3, 3)
      const fine = fbm(nx, ny, 27, 3, 12)
      const dry = fbm(nx + 0.3, ny + 0.7, 51, 2, 3)
      let r = 44 + clump * 20 + fine * 12
      let g = 70 + clump * 26 + fine * 16
      let b = 31 + clump * 10 + fine * 8
      if (dry > 0.6) {
        const t = (dry - 0.6) / 0.4
        r += t * 34
        g += t * 24
        b += t * 6
      }
      // 修剪草坪的淡淡条纹
      const stripe = Math.sin(((x + y * 0.25) / size) * Math.PI * 2 * 3) * 2.2
      r += stripe
      g += stripe
      b += stripe * 0.5
      const i = (y * size + x) * 4
      image.data[i] = r
      image.data[i + 1] = g
      image.data[i + 2] = b
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)

  // 草叶：3 万根短线段，颜色随机；同时写入高度图让法线有细节
  const blades = ['#5a8237', '#446b2b', '#6d9745', '#375c25', '#7aa04c', '#4f7a30']
  for (let i = 0; i < 26000; i++) {
    const x = rng() * size
    const y = rng() * size
    const len = 2 + rng() * 5
    const lean = (rng() - 0.5) * 2.4
    ctx.strokeStyle = blades[(rng() * blades.length) | 0]!
    ctx.globalAlpha = 0.35 + rng() * 0.5
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + lean, y - len)
    ctx.stroke()
    hctx.strokeStyle = rng() > 0.5 ? '#a8a8a8' : '#d0d0d0'
    hctx.lineWidth = 1
    hctx.beginPath()
    hctx.moveTo(x, y)
    hctx.lineTo(x + lean, y - len)
    hctx.stroke()
  }
  ctx.globalAlpha = 1

  // 三叶草 / 小野花（少量点缀，避免草地像撒了纸屑）
  for (let i = 0; i < 34; i++) {
    const x = rng() * size
    const y = rng() * size
    const white = rng() > 0.45
    wrappedCircle(ctx, size, x, y, 1.3 + rng() * 1.3, white ? '#e6e8d2' : '#dccd55')
    wrappedCircle(hctx, size, x, y, 1.1, '#e0e0e0')
  }

  return finishSurface(canvas, hCanvas, size, 1.25, 0.94, 0, 0.07, 3)
}

/* ------------------------------ 沥青 ------------------------------ */

function asphaltSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(99821)

  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 5, 3, 4)
      const g = 58 + n * 22 + (grain(x, y, 9) - 0.5) * 9
      const i = (y * size + x) * 4
      image.data[i] = g
      image.data[i + 1] = g + 2
      image.data[i + 2] = g + 5
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)

  // 骨料颗粒
  for (let i = 0; i < 6500; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 0.5 + rng() * 1.3
    const light = rng() > 0.45
    const v = light ? 88 + rng() * 48 : 20 + rng() * 15
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    hctx.fillStyle = light ? '#c0c0c0' : '#585858'
    hctx.beginPath()
    hctx.arc(x, y, r, 0, Math.PI * 2)
    hctx.fill()
  }

  // 裂缝
  ctx.strokeStyle = 'rgba(16,18,21,0.75)'
  hctx.strokeStyle = '#404040'
  for (let i = 0; i < 7; i++) {
    let x = rng() * size
    let y = rng() * size
    ctx.lineWidth = 1 + rng() * 1.4
    hctx.lineWidth = 1.4
    ctx.beginPath()
    hctx.beginPath()
    ctx.moveTo(x, y)
    hctx.moveTo(x, y)
    for (let s = 0; s < 14; s++) {
      x += (rng() - 0.5) * 42
      y += (rng() - 0.5) * 42
      ctx.lineTo(x, y)
      hctx.lineTo(x, y)
    }
    ctx.stroke()
    hctx.stroke()
  }

  // 油渍 / 修补块
  for (let i = 0; i < 9; i++) {
    wrappedCircle(ctx, size, rng() * size, rng() * size, 12 + rng() * 44, 'rgba(24,26,29,0.22)')
  }

  return finishSurface(canvas, hCanvas, size, 1.8, 0.9, 0, 0.06, 11)
}

/* ------------------------------ 人行道铺装 ------------------------------ */

function paverSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(4412)
  const pw = 128
  const ph = 64
  const colors = ['#a09788', '#a89e90', '#948b7d', '#9c8e82', '#8e8174', '#ab9c8a']

  ctx.fillStyle = '#5c574e'
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#4a4a4a'
  hctx.fillRect(0, 0, size, size)

  for (let row = 0; row * ph < size; row++) {
    const offset = row % 2 === 0 ? 0 : pw / 2
    for (let col = -1; col * pw < size + pw; col++) {
      const x = col * pw + offset + 2
      const y = row * ph + 2
      const w = pw - 4
      const h = ph - 4
      const base = colors[(rng() * colors.length) | 0]!
      ctx.fillStyle = base
      ctx.fillRect(x, y, w, h)
      // 倒角高光 / 阴影
      ctx.fillStyle = 'rgba(255,255,255,0.16)'
      ctx.fillRect(x, y, w, 2)
      ctx.fillRect(x, y, 2, h)
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.fillRect(x, y + h - 2, w, 2)
      ctx.fillRect(x + w - 2, y, 2, h)
      // 石材颗粒
      for (let i = 0; i < 26; i++) {
        const v = rng() > 0.5 ? 255 : 0
        ctx.fillStyle = `rgba(${v},${v},${v},0.06)`
        ctx.fillRect(x + rng() * w, y + rng() * h, 1, 1)
      }
      hctx.fillStyle = '#c4c4c4'
      hctx.fillRect(x, y, w, h)
      hctx.fillStyle = '#e8e8e8'
      hctx.fillRect(x, y, w, 3)
      hctx.fillStyle = '#8a8a8a'
      hctx.fillRect(x, y + h - 3, w, 3)
    }
  }

  // 缝隙里的泥土 / 青苔
  for (let i = 0; i < 70; i++) {
    wrappedCircle(ctx, size, rng() * size, rng() * size, 2 + rng() * 9, 'rgba(62,74,44,0.22)')
  }

  return finishSurface(canvas, hCanvas, size, 1.6, 0.88, 0, 0.05, 23)
}

/* ------------------------------ 广场石材 ------------------------------ */

function plazaSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(7781)
  const grid = 256

  ctx.fillStyle = '#6f6c66'
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#4c4c4c'
  hctx.fillRect(0, 0, size, size)

  for (let gy = -1; gy * grid < size + grid; gy++) {
    for (let gx = -1; gx * grid < size + grid; gx++) {
      const x = gx * grid + 3
      const y = gy * grid + 3
      const w = grid - 6
      const h = grid - 6
      const tone = 148 + rng() * 26
      ctx.fillStyle = `rgb(${tone},${tone - 3},${tone - 9})`
      ctx.fillRect(x, y, w, h)
      // 细密花岗岩斑点
      for (let i = 0; i < 900; i++) {
        const v = rng() > 0.55 ? 255 : 20
        ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + rng() * 0.09})`
        ctx.fillRect(x + rng() * w, y + rng() * h, 1 + rng() * 1.6, 1)
      }
      // 表面水渍 / 磨痕
      for (let i = 0; i < 4; i++) {
        wrappedCircle(ctx, size, x + rng() * w, y + rng() * h, 8 + rng() * 30, 'rgba(80,80,78,0.07)')
      }
      ctx.fillStyle = 'rgba(255,255,255,0.1)'
      ctx.fillRect(x, y, w, 2)
      hctx.fillStyle = '#c8c8c8'
      hctx.fillRect(x, y, w, h)
      hctx.fillStyle = '#e4e4e4'
      hctx.fillRect(x, y, w, 3)
    }
  }

  return finishSurface(canvas, hCanvas, size, 1.1, 0.66, 0.02, 0.04, 31)
}

/* ------------------------------ 屋面 ------------------------------ */

function roofSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(5209)

  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 61, 3, 5)
      const g = 116 + n * 30 + (grain(x, y, 3) - 0.5) * 16
      const i = (y * size + x) * 4
      image.data[i] = g
      image.data[i + 1] = g
      image.data[i + 2] = g - 2
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  hctx.fillStyle = '#909090'
  hctx.fillRect(0, 0, size, size)

  // 碎石保护层
  for (let i = 0; i < 12000; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 0.7 + rng() * 1.6
    const v = 90 + rng() * 85
    ctx.fillStyle = `rgba(${v},${v},${v},0.55)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    hctx.fillStyle = v > 110 ? '#d0d0d0' : '#707070'
    hctx.beginPath()
    hctx.arc(x, y, r, 0, Math.PI * 2)
    hctx.fill()
  }

  // 分格缝 + 防水卷材搭接
  ctx.strokeStyle = 'rgba(52,54,56,0.65)'
  hctx.strokeStyle = '#565656'
  ctx.lineWidth = 2
  hctx.lineWidth = 3
  for (let p = 0; p <= size; p += 256) {
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, size)
    ctx.moveTo(0, p)
    ctx.lineTo(size, p)
    ctx.stroke()
    hctx.beginPath()
    hctx.moveTo(p, 0)
    hctx.lineTo(p, size)
    hctx.moveTo(0, p)
    hctx.lineTo(size, p)
    hctx.stroke()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.04)'
  for (let p = 64; p < size; p += 128) ctx.fillRect(0, p, size, 2)

  // 积水 / 油污
  for (let i = 0; i < 16; i++) {
    wrappedCircle(ctx, size, rng() * size, rng() * size, 10 + rng() * 40, 'rgba(38,40,42,0.16)')
  }

  return finishSurface(canvas, hCanvas, size, 1.2, 0.92, 0, 0.07, 41)
}

/* ------------------------------ 石材（基座 / 台阶 / 柱） ------------------------------ */

function stoneSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(8134)
  const bw = 256
  const bh = 128

  ctx.fillStyle = '#6a665e'
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#4c4c4c'
  hctx.fillRect(0, 0, size, size)

  for (let row = 0; row * bh < size; row++) {
    const offset = row % 2 === 0 ? 0 : bw / 2
    for (let col = -1; col * bw < size + bw; col++) {
      const x = col * bw + offset + 2
      const y = row * bh + 2
      const w = bw - 4
      const h = bh - 4
      const tone = 156 + rng() * 34
      ctx.fillStyle = `rgb(${tone + 8},${tone + 4},${tone - 6})`
      ctx.fillRect(x, y, w, h)
      for (let i = 0; i < 480; i++) {
        const dark = rng() > 0.5
        ctx.fillStyle = dark ? `rgba(52,48,42,${0.06 + rng() * 0.12})` : `rgba(255,255,252,${0.05 + rng() * 0.1})`
        ctx.fillRect(x + rng() * w, y + rng() * h, 1 + rng() * 1.8, 1)
      }
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fillRect(x, y, w, 2)
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      ctx.fillRect(x, y + h - 2, w, 2)
      hctx.fillStyle = '#c6c6c6'
      hctx.fillRect(x, y, w, h)
      hctx.fillStyle = '#e8e8e8'
      hctx.fillRect(x, y, w, 3)
      hctx.fillStyle = '#9a9a9a'
      hctx.fillRect(x, y + h - 3, w, 3)
    }
  }

  return finishSurface(canvas, hCanvas, size, 1.7, 0.62, 0.03, 0.05, 53)
}

/* ------------------------------ 树皮 ------------------------------ */

function barkSurface(): SurfaceSet {
  const size = 256
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(6151)

  ctx.fillStyle = '#5a452f'
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)

  // 纵向树皮裂纹
  for (let i = 0; i < 90; i++) {
    let x = rng() * size
    const width = 1 + rng() * 4
    const dark = rng() > 0.35
    ctx.strokeStyle = dark ? 'rgba(48,34,22,0.65)' : 'rgba(132,102,70,0.5)'
    ctx.lineWidth = width
    hctx.strokeStyle = dark ? '#4a4a4a' : '#b4b4b4'
    hctx.lineWidth = width
    ctx.beginPath()
    hctx.beginPath()
    ctx.moveTo(x, -4)
    hctx.moveTo(x, -4)
    for (let y = 0; y <= size + 4; y += 8) {
      x += (rng() - 0.5) * 4
      ctx.lineTo(x, y)
      hctx.lineTo(x, y)
    }
    ctx.stroke()
    hctx.stroke()
  }
  // 横向皮孔 + 苔藓
  for (let i = 0; i < 120; i++) {
    const x = rng() * size
    const y = rng() * size
    ctx.fillStyle = 'rgba(34,26,18,0.5)'
    ctx.fillRect(x, y, 4 + rng() * 10, 1)
  }
  for (let i = 0; i < 24; i++) {
    wrappedCircle(ctx, size, rng() * size, rng() * size, 3 + rng() * 8, 'rgba(74,92,48,0.2)')
  }

  return finishSurface(canvas, hCanvas, size, 2.6, 0.95, 0, 0.08, 61)
}

/* ------------------------------ 树叶 ------------------------------ */

function leafSurface(): SurfaceSet {
  const size = 256
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(7349)

  ctx.fillStyle = '#2c4a22'
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#707070'
  hctx.fillRect(0, 0, size, size)

  const greens = ['#2f5524', '#41702e', '#538a38', '#2a4a20', '#629a41', '#78a94f', '#3a6229']
  for (let i = 0; i < 1500; i++) {
    const x = rng() * size
    const y = rng() * size
    const rx = 2.5 + rng() * 5
    const ry = 1.4 + rng() * 3
    const rot = rng() * Math.PI
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.fillStyle = greens[(rng() * greens.length) | 0]!
    ctx.beginPath()
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    hctx.save()
    hctx.translate(x, y)
    hctx.rotate(rot)
    hctx.fillStyle = rng() > 0.4 ? '#c8c8c8' : '#909090'
    hctx.beginPath()
    hctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    hctx.fill()
    hctx.restore()
  }
  // 缝隙阴影
  for (let i = 0; i < 220; i++) {
    const x = rng() * size
    const y = rng() * size
    ctx.fillStyle = 'rgba(14,26,10,0.28)'
    ctx.beginPath()
    ctx.arc(x, y, 1 + rng() * 3, 0, Math.PI * 2)
    ctx.fill()
  }

  return finishSurface(canvas, hCanvas, size, 2.2, 0.72, 0, 0.1, 71)
}

/* ------------------------------ 木材 ------------------------------ */

function woodSurface(): SurfaceSet {
  const size = 256
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(3927)
  const plank = 64

  ctx.fillStyle = '#7d4f2d'
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#909090'
  hctx.fillRect(0, 0, size, size)

  for (let p = 0; p < size; p += plank) {
    const tone = 96 + rng() * 34
    ctx.fillStyle = `rgb(${tone + 40},${tone - 6},${tone - 34})`
    ctx.fillRect(0, p + 2, size, plank - 4)
    ctx.strokeStyle = 'rgba(48,28,14,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, p + 1)
    ctx.lineTo(size, p + 1)
    ctx.stroke()
    hctx.strokeStyle = '#505050'
    hctx.lineWidth = 2
    hctx.beginPath()
    hctx.moveTo(0, p + 1)
    hctx.lineTo(size, p + 1)
    hctx.stroke()
    // 木纹
    for (let i = 0; i < 12; i++) {
      const y = p + 6 + rng() * (plank - 12)
      const amp = 1 + rng() * 2.2
      ctx.strokeStyle = `rgba(64,36,18,${0.1 + rng() * 0.16})`
      ctx.lineWidth = 0.8
      ctx.beginPath()
      for (let x = 0; x <= size; x += 16) {
        const yy = y + Math.sin((x / size) * Math.PI * 2 + i) * amp
        if (x === 0) ctx.moveTo(x, yy)
        else ctx.lineTo(x, yy)
      }
      ctx.stroke()
    }
    // 木节
    if (rng() > 0.55) {
      const kx = rng() * size
      const ky = p + plank / 2
      for (let r = 2; r < 12; r += 3) {
        ctx.strokeStyle = `rgba(52,28,12,${0.3 - r * 0.015})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(kx, ky, r, r * 0.6, 0.4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }

  return finishSurface(canvas, hCanvas, size, 0.9, 0.82, 0, 0.05, 83)
}

/* ------------------------------ 拉丝金属 ------------------------------ */

function metalSurface(): SurfaceSet {
  const size = 256
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(1567)

  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const brush = Math.sin(y * 0.9 + Math.sin(x * 0.02) * 2) * 6
      const g = 126 + brush + (grain(x, y, 5) - 0.5) * 14
      const i = (y * size + x) * 4
      image.data[i] = g
      image.data[i + 1] = g + 2
      image.data[i + 2] = g + 5
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)

  for (let i = 0; i < 60; i++) {
    const y = rng() * size
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(40,44,50,0.14)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y + (rng() - 0.5) * 2)
    ctx.stroke()
  }
  // 划痕
  for (let i = 0; i < 20; i++) {
    const x = rng() * size
    const y = rng() * size
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 0.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 10 + rng() * 40, y + (rng() - 0.5) * 4)
    ctx.stroke()
  }

  return finishSurface(canvas, hCanvas, size, 0.5, 0.34, 0.88, 0.05, 97)
}

/* ------------------------------ 沙滩 ------------------------------ */

function sandSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(2468)

  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ripple = Math.sin((y / size) * Math.PI * 2 * 9 + fbm(x / size, y / size, 4, 2, 3) * 6)
      const n = (grain(x, y, 13) - 0.5) * 14
      const i = (y * size + x) * 4
      image.data[i] = 214 + ripple * 8 + n
      image.data[i + 1] = 196 + ripple * 7 + n
      image.data[i + 2] = 152 + ripple * 6 + n * 0.7
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)

  // 砂砾 + 贝壳碎屑
  for (let i = 0; i < 2200; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 0.5 + rng() * 1.5
    const light = rng() > 0.5
    ctx.fillStyle = light ? 'rgba(255,250,232,0.75)' : 'rgba(160,136,98,0.55)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    hctx.fillStyle = light ? '#c8c8c8' : '#606060'
    hctx.beginPath()
    hctx.arc(x, y, r, 0, Math.PI * 2)
    hctx.fill()
  }
  for (let i = 0; i < 40; i++) {
    wrappedCircle(ctx, size, rng() * size, rng() * size, 2 + rng() * 6, 'rgba(255,255,255,0.35)')
  }

  return finishSurface(canvas, hCanvas, size, 1.1, 0.98, 0, 0.04, 101)
}

/* ------------------------------ 塑胶跑道 ------------------------------ */

function trackSurface(): SurfaceSet {
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const rng = seededRandom(9753)

  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, 33, 2, 6)
      const i = (y * size + x) * 4
      image.data[i] = 150 + n * 24
      image.data[i + 1] = 62 + n * 16
      image.data[i + 2] = 58 + n * 14
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)

  // 橡胶颗粒
  const grains = ['#b8534a', '#8e352f', '#d07064', '#6e2a26', '#e3ddd0', '#4d4d4d']
  for (let i = 0; i < 12000; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 0.6 + rng() * 1.7
    ctx.fillStyle = grains[(rng() * grains.length) | 0]!
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    hctx.fillStyle = rng() > 0.5 ? '#c8c8c8' : '#909090'
    hctx.beginPath()
    hctx.arc(x, y, r, 0, Math.PI * 2)
    hctx.fill()
  }

  return finishSurface(canvas, hCanvas, size, 1.5, 0.96, 0, 0.06, 107)
}

/* ======================================================================== */
/*                              建筑立面贴图                                 */
/* ======================================================================== */

export type FacadeVariant = 'brick' | 'tile' | 'concrete' | 'glass'

export interface FacadeSet {
  map: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  orm: THREE.CanvasTexture
  normalScale: number
}

interface FacadePalette {
  wall: [number, number, number]
  wallDark: string
  mortar: string
  trim: string
  frame: string
  glassTop: string
  glassMid: string
  glassBottom: string
  style: 'brick' | 'tile' | 'panel' | 'curtain'
  normal: number
  frameWhite: boolean
}

const FACADE_PALETTES: Record<FacadeVariant, FacadePalette> = {
  brick: {
    wall: [150, 96, 76],
    wallDark: 'rgba(96,58,44,0.5)',
    mortar: '#c0b3a3',
    trim: '#ded6c8',
    frame: '#4d5257',
    glassTop: '#9db9d0',
    glassMid: '#375469',
    glassBottom: '#243a4b',
    style: 'brick',
    normal: 2.1,
    frameWhite: false,
  },
  tile: {
    wall: [214, 206, 190],
    wallDark: 'rgba(150,142,126,0.45)',
    mortar: '#a29a8c',
    trim: '#eee8dc',
    frame: '#5b6168',
    glassTop: '#93b4cc',
    glassMid: '#3a5a72',
    glassBottom: '#27404f',
    style: 'tile',
    normal: 1.3,
    frameWhite: false,
  },
  concrete: {
    wall: [185, 183, 176],
    wallDark: 'rgba(120,118,112,0.45)',
    mortar: '#8e8c86',
    trim: '#d6d4ce',
    frame: '#4f555b',
    glassTop: '#9fbdd4',
    glassMid: '#3e5d74',
    glassBottom: '#294356',
    style: 'panel',
    normal: 1.0,
    frameWhite: false,
  },
  glass: {
    wall: [60, 76, 90],
    wallDark: 'rgba(30,40,50,0.5)',
    mortar: '#2c3944',
    trim: '#6b747c',
    frame: '#6c757d',
    glassTop: '#9fc1d8',
    glassMid: '#446a86',
    glassBottom: '#26465c',
    style: 'curtain',
    normal: 1.5,
    frameWhite: false,
  },
}

const FACADE_CACHE = new Map<FacadeVariant, FacadeSet>()

/** 建筑立面贴图组：2×2 个窗单元为一个可平铺 tile（墙面 + 窗户 + 夜晚自发光） */
export function facadeMaps(variant: FacadeVariant): FacadeSet {
  const cached = FACADE_CACHE.get(variant)
  if (cached) return cached
  const set = buildFacade(variant)
  FACADE_CACHE.set(variant, set)
  return set
}

const FACADE_SIZE = 512
const FACADE_CELL = 256

function buildFacade(variant: FacadeVariant): FacadeSet {
  const palette = FACADE_PALETTES[variant]
  const size = FACADE_SIZE
  const cell = FACADE_CELL
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: eCanvas, ctx: ectx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const { canvas: oCanvas, ctx: octx } = createCanvas(size, size)
  const rng = seededRandom(1000 + variant.length * 977)

  // ---- 墙面 ----
  ctx.fillStyle = `rgb(${palette.wall[0]},${palette.wall[1]},${palette.wall[2]})`
  ctx.fillRect(0, 0, size, size)
  hctx.fillStyle = '#808080'
  hctx.fillRect(0, 0, size, size)
  octx.fillStyle = 'rgb(255,214,0)'
  octx.fillRect(0, 0, size, size)
  ectx.fillStyle = '#000000'
  ectx.fillRect(0, 0, size, size)

  drawWallPattern(ctx, hctx, palette, size, rng)

  // ---- 窗单元 / 幕墙 ----
  const windows: { x: number; y: number; w: number; h: number; cool: boolean; lit: boolean }[] = []
  if (palette.style === 'curtain') {
    drawCurtainWall(ctx, ectx, hctx, octx, palette, size, rng, windows)
  } else {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const cx = col * cell
        const cy = row * cell
        drawWindowCell(ctx, ectx, hctx, octx, palette, cx, cy, cell, rng, windows)
      }
    }
  }

  // ---- 窗下污渍 / 墙面水痕 ----
  drawWallGrime(ctx, size, rng)

  // ---- 夜景自发光 ----
  // 先给所有玻璃一点月光反射，避免未开灯的窗在夜里是一片死黑
  for (const win of windows) {
    ectx.fillStyle = 'rgba(74,98,124,0.14)'
    ectx.fillRect(win.x, win.y, win.w, win.h)
  }
  // 再点亮约一半窗户
  for (const win of windows) {
    if (!win.lit) continue
    const warm = ectx.createLinearGradient(win.x, win.y, win.x, win.y + win.h)
    if (win.cool) {
      warm.addColorStop(0, '#dcefff')
      warm.addColorStop(1, '#8db7d8')
    } else {
      warm.addColorStop(0, '#ffe6ae')
      warm.addColorStop(0.65, '#ffc46e')
      warm.addColorStop(1, '#f09a3e')
    }
    ectx.fillStyle = warm
    ectx.globalAlpha = 0.7 + rng() * 0.3
    ectx.fillRect(win.x, win.y, win.w, win.h)
    ectx.globalAlpha = 1
    // 百叶 / 窗帘剪影
    if (rng() > 0.45) {
      ectx.fillStyle = 'rgba(60,40,20,0.35)'
      const blinds = 3 + ((rng() * 5) | 0)
      for (let b = 0; b < blinds; b++) {
        ectx.fillRect(win.x, win.y + (win.h / blinds) * b, win.w, 2)
      }
    }
  }

  const hctx2 = hCanvas.getContext('2d')!
  const field = heightField(hctx2, size)
  const orm = ormTextureFromCanvas(oCanvas, size)

  return {
    map: colorTexture(canvas),
    emissive: colorTexture(eCanvas),
    normalMap: normalMapFromHeight(field, size, palette.normal),
    orm,
    normalScale: palette.normal * 0.55,
  }
}

/** 墙面砖缝 / 瓷砖缝 / 混凝土分格 */
function drawWallPattern(
  ctx: CanvasRenderingContext2D,
  hctx: CanvasRenderingContext2D,
  palette: FacadePalette,
  size: number,
  rng: () => number,
) {
  if (palette.style === 'brick') {
    const bw = 32
    const bh = 8
    for (let row = 0; row * bh < size; row++) {
      const offset = row % 2 === 0 ? 0 : bw / 2
      for (let col = -1; col * bw < size + bw; col++) {
        const x = col * bw + offset + 1
        const y = row * bh + 1
        const w = bw - 2
        const h = bh - 2
        const shift = (rng() - 0.5) * 18
        ctx.fillStyle = `rgb(${palette.wall[0] + shift},${palette.wall[1] + shift * 0.8},${palette.wall[2] + shift * 0.7})`
        ctx.fillRect(x, y, w, h)
        ctx.fillStyle = 'rgba(255,255,255,0.05)'
        ctx.fillRect(x, y, w, 1)
        hctx.fillStyle = '#a8a8a8'
        hctx.fillRect(x, y, w, h)
      }
      ctx.strokeStyle = 'rgba(196,184,168,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, row * bh)
      ctx.lineTo(size, row * bh)
      ctx.stroke()
      hctx.strokeStyle = '#606060'
      hctx.lineWidth = 1.5
      hctx.beginPath()
      hctx.moveTo(0, row * bh)
      hctx.lineTo(size, row * bh)
      hctx.stroke()
    }
  } else if (palette.style === 'tile') {
    const tw = 32
    const th = 16
    for (let row = 0; row * th < size; row++) {
      for (let col = 0; col * tw < size; col++) {
        const x = col * tw + 1
        const y = row * th + 1
        const shift = (rng() - 0.5) * 12
        ctx.fillStyle = `rgb(${palette.wall[0] + shift},${palette.wall[1] + shift},${palette.wall[2] + shift})`
        ctx.fillRect(x, y, tw - 2, th - 2)
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
        ctx.fillRect(x, y, tw - 2, 1)
        hctx.fillStyle = '#b0b0b0'
        hctx.fillRect(x, y, tw - 2, th - 2)
      }
    }
    ctx.strokeStyle = 'rgba(150,142,128,0.5)'
    ctx.lineWidth = 1
    for (let row = 0; row * th < size; row++) {
      ctx.beginPath()
      ctx.moveTo(0, row * th)
      ctx.lineTo(size, row * th)
      ctx.stroke()
    }
    for (let col = 0; col * tw < size; col++) {
      ctx.beginPath()
      ctx.moveTo(col * tw, 0)
      ctx.lineTo(col * tw, size)
      ctx.stroke()
    }
    hctx.strokeStyle = '#6a6a6a'
    hctx.lineWidth = 1.5
    for (let row = 0; row * th < size; row++) {
      hctx.beginPath()
      hctx.moveTo(0, row * th)
      hctx.lineTo(size, row * th)
      hctx.stroke()
    }
    for (let col = 0; col * tw < size; col++) {
      hctx.beginPath()
      hctx.moveTo(col * tw, 0)
      hctx.lineTo(col * tw, size)
      hctx.stroke()
    }
  } else if (palette.style === 'panel') {
    // 混凝土分格缝 + 涂料颗粒
    for (let i = 0; i < 4200; i++) {
      const x = rng() * size
      const y = rng() * size
      const v = rng() > 0.5 ? 255 : 0
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rng() * 0.05})`
      ctx.fillRect(x, y, 1 + rng() * 2, 1)
      hctx.fillStyle = `rgba(${v},${v},${v},0.08)`
      hctx.fillRect(x, y, 1 + rng() * 2, 1)
    }
    ctx.strokeStyle = 'rgba(120,118,112,0.5)'
    ctx.lineWidth = 2
    hctx.strokeStyle = '#5e5e5e'
    hctx.lineWidth = 3
    for (let p = 0; p <= size; p += 128) {
      ctx.beginPath()
      ctx.moveTo(p, 0)
      ctx.lineTo(p, size)
      ctx.stroke()
      hctx.beginPath()
      hctx.moveTo(p, 0)
      hctx.lineTo(p, size)
      hctx.stroke()
    }
    for (let p = 0; p <= size; p += 256) {
      ctx.beginPath()
      ctx.moveTo(0, p)
      ctx.lineTo(size, p)
      ctx.stroke()
      hctx.beginPath()
      hctx.moveTo(0, p)
      hctx.lineTo(size, p)
      hctx.stroke()
    }
  } else {
    // 幕墙：竖挺 + 层间腰线
    for (let i = 0; i < 1600; i++) {
      const x = rng() * size
      const y = rng() * size
      const v = rng() > 0.5 ? 255 : 0
      ctx.fillStyle = `rgba(${v},${v},${v},0.03)`
      ctx.fillRect(x, y, 1, 2)
    }
  }
}

/** 单个窗户单元：窗框、玻璃、窗台、空调外机 */
function drawWindowCell(
  ctx: CanvasRenderingContext2D,
  ectx: CanvasRenderingContext2D,
  hctx: CanvasRenderingContext2D,
  octx: CanvasRenderingContext2D,
  palette: FacadePalette,
  cx: number,
  cy: number,
  cell: number,
  rng: () => number,
  windows: { x: number; y: number; w: number; h: number; cool: boolean; lit: boolean }[],
) {
  const x = cx + cell * 0.245
  const y = cy + cell * 0.225
  const w = cell * 0.51
  const h = cell * 0.47

  // 窗框
  const frame = 6
  ctx.fillStyle = palette.frameWhite ? '#e9e6dd' : palette.frame
  ctx.fillRect(x - frame, y - frame, w + frame * 2, h + frame * 2)
  hctx.fillStyle = '#bebebe'
  hctx.fillRect(x - frame, y - frame, w + frame * 2, h + frame * 2)
  octx.fillStyle = 'rgb(255,96,196)'
  octx.fillRect(x - frame, y - frame, w + frame * 2, h + frame * 2)

  // 玻璃
  const grad = ctx.createLinearGradient(0, y, 0, y + h)
  grad.addColorStop(0, palette.glassTop)
  grad.addColorStop(0.42, palette.glassMid)
  grad.addColorStop(1, palette.glassBottom)
  ctx.fillStyle = grad
  ctx.fillRect(x, y, w, h)

  // 天空反光斜带
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.beginPath()
  ctx.moveTo(x - 10, y + h * 0.15)
  ctx.lineTo(x + w * 0.55, y - 10)
  ctx.lineTo(x + w * 0.8, y - 10)
  ctx.lineTo(x - 10, y + h * 0.45)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 室内：百叶 / 窗帘 / 亮灯
  const interior = rng()
  const cool = rng() > 0.86
  if (interior < 0.46) {
    // 百叶
    ctx.fillStyle = 'rgba(224,219,205,0.5)'
    const blinds = 4 + ((rng() * 6) | 0)
    for (let b = 0; b < blinds; b++) {
      ctx.fillRect(x + 2, y + 3 + ((h - 6) / blinds) * b, w - 4, 2)
    }
  } else if (interior < 0.7) {
    // 窗帘
    ctx.fillStyle = 'rgba(232,222,200,0.55)'
    ctx.fillRect(x + 2, y + 2, w * 0.28, h - 4)
    ctx.fillStyle = 'rgba(112,118,104,0.5)'
    ctx.fillRect(x + w * 0.72, y + 2, w * 0.26, h - 4)
    for (let c = 0; c < 4; c++) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(x + 4 + c * 6, y + 2, 2, h - 4)
    }
  } else if (interior < 0.82) {
    // 室内暖光
    const warm = ctx.createLinearGradient(0, y, 0, y + h)
    warm.addColorStop(0, 'rgba(255,228,170,0.85)')
    warm.addColorStop(1, 'rgba(240,168,80,0.7)')
    ctx.fillStyle = warm
    ctx.fillRect(x, y, w, h)
  } else {
    // 深色室内 + 家具剪影
    ctx.fillStyle = 'rgba(18,26,34,0.55)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(40,50,58,0.7)'
    ctx.fillRect(x + w * 0.15, y + h * 0.55, w * 0.3, h * 0.35)
  }

  // 夜景：约一半窗户会亮灯（与白天室内图案无关，百叶窗后也可能亮着）
  windows.push({
    x: x + 1,
    y: y + 1,
    w: w - 2,
    h: h - 2,
    cool,
    lit: rng() < 0.52,
  })

  // 中挺 / 开启扇
  ctx.fillStyle = palette.frameWhite ? '#e9e6dd' : palette.frame
  ctx.fillRect(x + w * 0.5 - 1.5, y, 3, h)
  if (rng() > 0.5) ctx.fillRect(x, y + h * 0.18, w, 2.5)

  // 玻璃高度（凹进墙体）
  hctx.fillStyle = '#434343'
  hctx.fillRect(x, y, w, h)

  // 窗台
  ctx.fillStyle = palette.trim
  ctx.fillRect(x - 9, y + h + 1, w + 18, 7)
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(x - 9, y + h + 8, w + 18, 3)
  hctx.fillStyle = '#e8e8e8'
  hctx.fillRect(x - 9, y + h + 1, w + 18, 7)
  octx.fillStyle = 'rgb(255,150,12)'
  octx.fillRect(x - 9, y + h + 1, w + 18, 7)

  // 空调外机（约 35% 窗户）
  if (rng() > 0.65) {
    const ax = x + w - cell * 0.17
    const ay = y + h + 14
    const aw = cell * 0.16
    const ah = cell * 0.1
    ctx.fillStyle = '#c9c9c2'
    ctx.fillRect(ax, ay, aw, ah)
    ctx.strokeStyle = 'rgba(70,70,66,0.7)'
    ctx.lineWidth = 1
    ctx.strokeRect(ax, ay, aw, ah)
    for (let g = 0; g < 5; g++) {
      ctx.fillStyle = 'rgba(90,90,86,0.5)'
      ctx.fillRect(ax + 2, ay + 2 + g * 3, aw - 4, 1)
    }
    hctx.fillStyle = '#d8d8d8'
    hctx.fillRect(ax, ay, aw, ah)
    octx.fillStyle = 'rgb(255,120,150)'
    octx.fillRect(ax, ay, aw, ah)
  }
}

/** 玻璃幕墙：竖向竖挺 + 层间腰线 + 2×2 网格 */
function drawCurtainWall(
  ctx: CanvasRenderingContext2D,
  ectx: CanvasRenderingContext2D,
  hctx: CanvasRenderingContext2D,
  octx: CanvasRenderingContext2D,
  palette: FacadePalette,
  size: number,
  rng: () => number,
  windows: { x: number; y: number; w: number; h: number; cool: boolean; lit: boolean }[],
) {
  const paneW = 64
  const paneH = 128

  // 幕墙玻璃
  for (let row = 0; row * paneH < size; row++) {
    for (let col = 0; col * paneW < size; col++) {
      const x = col * paneW
      const y = row * paneH
      const grad = ctx.createLinearGradient(0, y, 0, y + paneH)
      grad.addColorStop(0, palette.glassTop)
      grad.addColorStop(0.45, palette.glassMid)
      grad.addColorStop(1, palette.glassBottom)
      ctx.fillStyle = grad
      ctx.fillRect(x, y, paneW, paneH)
      // 每块玻璃的色差 / 天空反光
      ctx.fillStyle = `rgba(${rng() > 0.5 ? '255,255,255' : '10,30,44'},${0.02 + rng() * 0.07})`
      ctx.fillRect(x, y, paneW, paneH)
      if (rng() > 0.55) {
        ctx.fillStyle = 'rgba(255,255,255,0.1)'
        ctx.beginPath()
        ctx.moveTo(x, y + paneH * (0.2 + rng() * 0.4))
        ctx.lineTo(x + paneW, y + paneH * (0.05 + rng() * 0.3))
        ctx.lineTo(x + paneW, y + paneH * 0.45)
        ctx.lineTo(x, y + paneH * 0.75)
        ctx.closePath()
        ctx.fill()
      }
      // 点亮 / 深色室内
      const r = rng()
      const isLit = r < 0.42
      if (isLit) {
        const warm = ctx.createLinearGradient(0, y + 20, 0, y + paneH)
        warm.addColorStop(0, 'rgba(255,236,190,0.8)')
        warm.addColorStop(1, 'rgba(240,180,100,0.6)')
        ctx.fillStyle = warm
        ctx.fillRect(x + 4, y + 18, paneW - 8, paneH - 24)
      }
      windows.push({
        x: x + 5,
        y: y + 19,
        w: paneW - 10,
        h: paneH - 26,
        cool: rng() > 0.8,
        lit: isLit,
      })
      // 高度：玻璃凹进
      hctx.fillStyle = '#505050'
      hctx.fillRect(x, y, paneW, paneH)
      octx.fillStyle = 'rgb(238,20,0)'
      octx.fillRect(x, y, paneW, paneH)
    }
  }

  // 层间腰线（深色铝板）
  for (let y = 0; y < size; y += 256) {
    ctx.fillStyle = '#2b333a'
    ctx.fillRect(0, y, size, 18)
    ctx.fillStyle = 'rgba(255,255,255,0.1)'
    ctx.fillRect(0, y, size, 2)
    hctx.fillStyle = '#c8c8c8'
    hctx.fillRect(0, y, size, 18)
    octx.fillStyle = 'rgb(255,80,190)'
    octx.fillRect(0, y, size, 18)
  }

  // 竖向竖挺
  for (let x = 0; x < size; x += paneW) {
    ctx.fillStyle = '#59636b'
    ctx.fillRect(x, 0, 3, size)
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(x, 0, 1, size)
    hctx.fillStyle = '#d8d8d8'
    hctx.fillRect(x, 0, 3, size)
    octx.fillStyle = 'rgb(255,80,190)'
    octx.fillRect(x, 0, 3, size)
  }
}

/** 窗下雨水痕：真实的楼立面几乎都有 */
function drawWallGrime(ctx: CanvasRenderingContext2D, size: number, rng: () => number) {
  for (let i = 0; i < 40; i++) {
    const x = rng() * size
    const w = 2 + rng() * 7
    const top = rng() * size
    const len = 20 + rng() * 90
    const grad = ctx.createLinearGradient(0, top, 0, top + len)
    grad.addColorStop(0, 'rgba(52,48,42,0.16)')
    grad.addColorStop(1, 'rgba(52,48,42,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x, top, w, len)
  }
  // 大块雨渍 / 霉斑
  for (let i = 0; i < 8; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = 20 + rng() * 60
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(60,58,52,0.09)')
    g.addColorStop(1, 'rgba(60,58,52,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/** ORM 画布 → 纹理（先在图里画出 G/B 值，再叠一点噪声） */
function ormTextureFromCanvas(canvas: HTMLCanvasElement, size: number) {
  const ctx = canvas.getContext('2d')!
  const image = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < size * size; i++) {
    const p = i * 4
    const n = (grain(i % size, (i / size) | 0, 5) - 0.5) * 10
    image.data[p + 1] = Math.max(2, Math.min(255, (image.data[p + 1] ?? 0) + n))
  }
  ctx.putImageData(image, 0, 0)
  return dataTexture(canvas)
}

/* ======================================================================== */
/*                          底层商铺 / 门厅贴图                              */
/* ======================================================================== */

export interface StorefrontSet {
  map: THREE.CanvasTexture
  emissive: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  orm: THREE.CanvasTexture
}

let storefrontCache: StorefrontSet | null = null

/** 底层门厅：石材壁柱 + 落地玻璃 + 深色铝板雨棚 + 室内暖光 */
export function storefrontMaps(): StorefrontSet {
  if (storefrontCache) return storefrontCache
  const size = 512
  const { canvas, ctx } = createCanvas(size, size)
  const { canvas: eCanvas, ctx: ectx } = createCanvas(size, size)
  const { canvas: hCanvas, ctx: hctx } = createCanvas(size, size)
  const { canvas: oCanvas, ctx: octx } = createCanvas(size, size)
  const rng = seededRandom(6543)

  // 石材底
  ctx.fillStyle = '#b7afa1'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 2600; i++) {
    const v = rng() > 0.5 ? 255 : 0
    ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rng() * 0.06})`
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1)
  }
  // 石材分缝
  ctx.strokeStyle = 'rgba(96,90,80,0.5)'
  ctx.lineWidth = 2
  for (let x = 0; x <= size; x += 128) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size)
    ctx.stroke()
  }
  for (let y = 0; y <= size; y += 128) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  }

  hctx.fillStyle = '#909090'
  hctx.fillRect(0, 0, size, size)
  octx.fillStyle = 'rgb(255,190,8)'
  octx.fillRect(0, 0, size, size)

  // 深色铝板门头（顶部）
  ctx.fillStyle = '#2c3034'
  ctx.fillRect(0, 0, size, 84)
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(0, 6, size, 1)
  ctx.fillStyle = '#c9a45c'
  ctx.fillRect(24, 70, size - 48, 2)
  hctx.fillStyle = '#c0c0c0'
  hctx.fillRect(0, 0, size, 84)
  octx.fillStyle = 'rgb(255,90,190)'
  octx.fillRect(0, 0, size, 84)
  // 门头筒灯
  for (let i = 0; i < 5; i++) {
    const lx = 52 + i * 102
    const g = ctx.createRadialGradient(lx, 74, 0, lx, 74, 16)
    g.addColorStop(0, 'rgba(255,226,160,0.85)')
    g.addColorStop(1, 'rgba(255,226,160,0)')
    ctx.fillStyle = g
    ctx.fillRect(lx - 16, 58, 32, 32)
    ectx.fillStyle = 'rgba(255,214,150,0.9)'
    ectx.beginPath()
    ectx.arc(lx, 74, 2.4, 0, Math.PI * 2)
    ectx.fill()
  }

  // 玻璃幕墙区域
  const gx = 52
  const gy = 96
  const gw = 408
  const gh = 340
  const glassGrad = ctx.createLinearGradient(0, gy, 0, gy + gh)
  glassGrad.addColorStop(0, '#a7c7df')
  glassGrad.addColorStop(0.35, '#4d748f')
  glassGrad.addColorStop(1, '#1c2f3e')
  ctx.fillStyle = glassGrad
  ctx.fillRect(gx, gy, gw, gh)

  // 室内：地面、货架、吧台、灯光
  ctx.save()
  ctx.beginPath()
  ctx.rect(gx, gy, gw, gh)
  ctx.clip()
  ctx.fillStyle = 'rgba(240,212,168,0.4)'
  ctx.fillRect(gx, gy + gh * 0.55, gw, gh * 0.45)
  for (let i = 0; i < 3; i++) {
    const sx = gx + 24 + i * 132
    ctx.fillStyle = 'rgba(36,42,46,0.55)'
    ctx.fillRect(sx, gy + gh * 0.3, 90, 8)
    ctx.fillRect(sx, gy + gh * 0.48, 90, 8)
    ctx.fillStyle = 'rgba(255,232,180,0.5)'
    ctx.fillRect(sx + 6, gy + gh * 0.33, 78, 3)
    ctx.fillRect(sx + 6, gy + gh * 0.51, 78, 3)
  }
  // 暖光光晕
  for (let i = 0; i < 6; i++) {
    const lx = gx + 40 + i * 70
    const ly = gy + gh * (0.2 + rng() * 0.3)
    const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 46)
    g.addColorStop(0, 'rgba(255,232,186,0.5)')
    g.addColorStop(1, 'rgba(255,232,186,0)')
    ctx.fillStyle = g
    ctx.fillRect(lx - 46, ly - 46, 92, 92)
    ectx.fillStyle = 'rgba(255,206,140,0.45)'
    ectx.beginPath()
    ectx.arc(lx, ly, 20, 0, Math.PI * 2)
    ectx.fill()
  }
  // 反光斜带
  ctx.fillStyle = 'rgba(255,255,255,0.13)'
  ctx.beginPath()
  ctx.moveTo(gx - 20, gy + 120)
  ctx.lineTo(gx + 190, gy - 20)
  ctx.lineTo(gx + 280, gy - 20)
  ctx.lineTo(gx - 20, gy + 220)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // 铝框
  ctx.fillStyle = '#3c4248'
  ctx.fillRect(gx - 6, gy - 6, gw + 12, 7)
  ctx.fillRect(gx - 6, gy + gh - 1, gw + 12, 7)
  ctx.fillRect(gx - 6, gy - 6, 7, gh + 12)
  ctx.fillRect(gx + gw - 1, gy - 6, 7, gh + 12)
  for (const mx of [gx + 136, gx + 272]) {
    ctx.fillRect(mx - 3, gy, 6, gh)
  }
  ctx.fillRect(gx, gy + 112, gw, 5)

  // 中间一扇玻璃门
  const doorX = gx + 150
  const doorW = 108
  ctx.fillStyle = 'rgba(24,34,42,0.45)'
  ctx.fillRect(doorX, gy + 30, doorW, gh - 40)
  ctx.fillStyle = '#3c4248'
  ctx.fillRect(doorX + doorW / 2 - 2, gy + 30, 4, gh - 40)
  ctx.fillStyle = '#cfd3d6'
  ctx.fillRect(doorX + doorW / 2 + 10, gy + gh * 0.55, 4, 34)
  ctx.fillStyle = 'rgba(200,205,210,0.35)'
  ctx.fillRect(doorX + 6, gy + gh - 60, doorW - 12, 26)

  // 高度：玻璃凹进、框凸起
  hctx.fillStyle = '#4a4a4a'
  hctx.fillRect(gx, gy, gw, gh)
  hctx.fillStyle = '#d8d8d8'
  hctx.fillRect(gx - 6, gy - 6, gw + 12, 9)
  hctx.fillRect(gx - 6, gy - 6, 9, gh + 12)
  hctx.fillRect(gx + gw - 3, gy - 6, 9, gh + 12)

  // ORM：玻璃光滑、铝框金属、石材粗糙
  octx.fillStyle = 'rgb(240,22,0)'
  octx.fillRect(gx, gy, gw, gh)
  octx.fillStyle = 'rgb(255,86,196)'
  octx.fillRect(gx - 6, gy - 6, gw + 12, 7)
  octx.fillRect(gx - 6, gy + gh - 1, gw + 12, 7)
  octx.fillRect(gx - 6, gy - 6, 7, gh + 12)
  octx.fillRect(gx + gw - 1, gy - 6, 7, gh + 12)
  for (const mx of [gx + 136, gx + 272]) octx.fillRect(mx - 3, gy, 6, gh)

  storefrontCache = {
    map: colorTexture(canvas),
    emissive: colorTexture(eCanvas),
    normalMap: normalMapFromHeight(heightField(hctx, size), size, 1.6),
    orm: ormTextureFromCanvas(oCanvas, size),
  }
  return storefrontCache
}

/* ======================================================================== */
/*                              其他小工具                                   */
/* ======================================================================== */

/** 斑马线贴图：透明底 + 白色长条，带一点磨损 */
export function crosswalkTexture(): THREE.CanvasTexture {
  const size = 256
  const { canvas, ctx } = createCanvas(size, size)
  ctx.clearRect(0, 0, size, size)
  const bars = 5
  for (let i = 0; i < bars; i++) {
    const y = (size / bars) * i + size / bars * 0.2
    const h = size / bars * 0.6
    ctx.fillStyle = 'rgba(238,238,232,0.92)'
    ctx.fillRect(0, y, size, h)
  }
  // 磨损
  ctx.globalCompositeOperation = 'destination-out'
  const rng = seededRandom(4321)
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + rng() * 0.5})`
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 4, 1 + rng() * 2)
  }
  ctx.globalCompositeOperation = 'source-over'
  const tex = colorTexture(canvas)
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

/** 足球场：草坪条纹 + 白线，配合草地法线使用 */
export function soccerFieldTexture(): THREE.CanvasTexture {
  const w = 512
  const h = 352
  const { canvas, ctx } = createCanvas(w, h)
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#3f7c33' : '#47893a'
    ctx.fillRect((i * w) / 10, 0, w / 10, h)
  }
  const rng = seededRandom(1122)
  for (let i = 0; i < 5000; i++) {
    const v = rng() > 0.5 ? '255,255,255' : '0,0,0'
    ctx.fillStyle = `rgba(${v},${0.04 + rng() * 0.06})`
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1)
  }
  ctx.strokeStyle = 'rgba(248,248,244,0.9)'
  ctx.lineWidth = 4
  ctx.strokeRect(28, 24, 456, 304)
  ctx.beginPath()
  ctx.moveTo(256, 24)
  ctx.lineTo(256, 328)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(256, 176, 52, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeRect(28, 106, 72, 140)
  ctx.strokeRect(412, 106, 72, 140)
  return colorTexture(canvas)
}

/** 篮球场：塑胶面层 + 白线 + 磨损 */
export function basketballCourtTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(320, 256)
  const rng = seededRandom(3311)
  ctx.fillStyle = '#4a7d55'
  ctx.fillRect(0, 0, 320, 256)
  for (let i = 0; i < 5000; i++) {
    const v = rng() > 0.5 ? '255,255,255' : '0,0,0'
    ctx.fillStyle = `rgba(${v},${0.03 + rng() * 0.05})`
    ctx.fillRect(rng() * 320, rng() * 256, 1, 1)
  }
  ctx.fillStyle = '#7d5646'
  ctx.fillRect(60, 60, 200, 136)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 4
  ctx.strokeRect(60, 60, 200, 136)
  ctx.beginPath()
  ctx.moveTo(160, 60)
  ctx.lineTo(160, 196)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(160, 128, 30, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeRect(60, 98, 44, 60)
  ctx.strokeRect(216, 98, 44, 60)
  return colorTexture(canvas)
}
