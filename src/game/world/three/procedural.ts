import * as THREE from 'three'

/**
 * 程序化贴图基础设施：
 * - 可平铺噪声（保证地面 / 墙面铺开无接缝）
 * - 高度图 → 法线贴图
 * - ORM 打包贴图（G = 粗糙度，B = 金属度，R = 环境光遮蔽）
 * - UV 缩放、动画循环中复用的小工具
 */

let anisotropy = 8

/** 按渲染器能力设置各向异性过滤等级（贴图在斜视角下更清晰） */
export function setTextureAnisotropy(value: number) {
  anisotropy = Math.max(1, Math.min(16, Math.round(value)))
}

export function textureAnisotropy() {
  return anisotropy
}

export function createCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx }
}

function configure(tex: THREE.CanvasTexture, srgb: boolean) {
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.anisotropy = anisotropy
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

/** 画布 → 纹理（颜色贴图，sRGB） */
export function colorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  return configure(new THREE.CanvasTexture(canvas), true)
}

/** 画布 → 纹理（数据贴图：法线 / 粗糙度，线性空间） */
export function dataTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  return configure(new THREE.CanvasTexture(canvas), false)
}

/* ------------------------------ 噪声 ------------------------------ */

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const fade = (t: number) => t * t * (3 - 2 * t)

/** 周期性 value noise：period 为格子周期（整数），可无缝平铺 */
export function periodicNoise(x: number, y: number, period: number, seed: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const tx = fade(x - xi)
  const ty = fade(y - yi)
  const wrap = (v: number) => ((v % period) + period) % period
  const x0 = wrap(xi)
  const x1 = wrap(xi + 1)
  const y0 = wrap(yi)
  const y1 = wrap(yi + 1)
  const a = hash2(x0, y0, seed)
  const b = hash2(x1, y0, seed)
  const c = hash2(x0, y1, seed)
  const d = hash2(x1, y1, seed)
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return top + (bottom - top) * ty
}

/** 分形噪声，x/y 归一化到 [0,1)，period 为基础格子周期 */
export function fbm(x: number, y: number, seed: number, octaves = 4, period = 4) {
  let sum = 0
  let amp = 0.5
  let total = 0
  let p = period
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(x * p, y * p, p, seed + o * 131) * amp
    total += amp
    amp *= 0.5
    p *= 2
  }
  return sum / total
}

/** 细颗粒噪声（不做插值，便宜且适合砂砾 / 草地碎屑） */
export function grain(x: number, y: number, seed: number) {
  return hash2(x, y, seed)
}

/** 可平铺的随机数生成器 */
export function seededRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------ 绘制辅助 ------------------------------ */

/** 在画布边缘自动补画，保证径向渐变圆斑跨边界时依然无缝 */
export function wrappedCircle(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  r: number,
  fill: string | CanvasGradient,
) {
  const draw = (cx: number, cy: number) => {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
  }
  draw(x, y)
  if (x - r < 0) draw(x + size, y)
  if (x + r > size) draw(x - size, y)
  if (y - r < 0) draw(x, y + size)
  if (y + r > size) draw(x, y - size)
  if (x - r < 0 && y - r < 0) draw(x + size, y + size)
  if (x - r < 0 && y + r > size) draw(x + size, y - size)
  if (x + r > size && y - r < 0) draw(x - size, y + size)
  if (x + r > size && y + r > size) draw(x - size, y - size)
}

export function wrappedRect(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  const draw = (cx: number, cy: number) => {
    ctx.fillStyle = fill
    ctx.fillRect(cx, cy, w, h)
  }
  draw(x, y)
  if (x < 0) draw(x + size, y)
  if (x + w > size) draw(x - size, y)
  if (y < 0) draw(x, y + size)
  if (y + h > size) draw(x, y - size)
}

/* ------------------------------ 高度 → 法线 / ORM ------------------------------ */

/** RGBA 高度图（灰度）→ 切线空间法线贴图 */
export function normalMapFromHeight(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size)
  const image = ctx.createImageData(size, size)
  const at = (x: number, y: number) =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)] ?? 0.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength
      const len = Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      image.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      image.data[i + 2] = (1 / len) * 255
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return dataTexture(canvas)
}

export interface OrmOptions {
  /** 粗糙度（0 光滑 ~ 1 粗糙），返回 null 表示该像素保持底色 */
  roughness: number | ((x: number, y: number, nx: number, ny: number) => number | null)
  /** 金属度 */
  metalness: number | ((x: number, y: number, nx: number, ny: number) => number | null)
  /** 环境光遮蔽（默认 1） */
  ao?: number | ((x: number, y: number, nx: number, ny: number) => number | null)
  /** 粒度扰动幅度 */
  variation?: number
  seed?: number
}

/** 生成 ORM 打包贴图：R=AO, G=粗糙度, B=金属度（three 的 roughnessMap 取 G、metalnessMap 取 B） */
export function ormTexture(size: number, opts: OrmOptions): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size, size)
  const image = ctx.createImageData(size, size)
  const variation = opts.variation ?? 0.05
  const seed = opts.seed ?? 7
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size
      const ny = y / size
      const n = (grain(x, y, seed) - 0.5) * variation
      const r = typeof opts.roughness === 'function' ? opts.roughness(x, y, nx, ny) : opts.roughness
      const m = typeof opts.metalness === 'function' ? opts.metalness(x, y, nx, ny) : opts.metalness
      const aoValue = typeof opts.ao === 'function' ? opts.ao(x, y, nx, ny) : opts.ao
      const ao = aoValue ?? 1
      const i = (y * size + x) * 4
      image.data[i] = Math.round(THREE.MathUtils.clamp(ao, 0, 1) * 255)
      image.data[i + 1] = Math.round(THREE.MathUtils.clamp((r ?? 0.85) + n, 0.02, 1) * 255)
      image.data[i + 2] = Math.round(THREE.MathUtils.clamp((m ?? 0) + n * 0.4, 0, 1) * 255)
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return dataTexture(canvas)
}

/* ------------------------------ UV 工具 ------------------------------ */

/** 按世界尺寸缩放几何体 UV（配合 repeat 始终为 1 的共享贴图使用） */
export function scaleUv(geo: THREE.BufferGeometry, u: number, v: number) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) return geo
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v)
  }
  uv.needsUpdate = true
  return geo
}

/**
 * 盒体六个面按各自实际尺寸缩放 UV：
 * 侧面 / 正背面用不同比例，保证窗户在任意长宽的楼上都不被拉伸。
 * scales 顺序与 BoxGeometry 面顺序一致：px, nx, py, ny, pz, nz，每项 [u, v]。
 */
export function scaleBoxUv(
  geo: THREE.BoxGeometry,
  scales: [number, number][],
) {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let face = 0; face < 6; face++) {
    const [su, sv] = scales[face] ?? [1, 1]
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv)
    }
  }
  uv.needsUpdate = true
  return geo
}

/** 平移指定面的 UV：用于让相邻建筑使用不同的窗格 / 亮灯图案 */
export function offsetBoxUv(
  geo: THREE.BoxGeometry,
  faces: number[],
  du: number,
  dv: number,
) {
  if (du === 0 && dv === 0) return geo
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (const face of faces) {
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i
      uv.setXY(idx, uv.getX(idx) + du, uv.getY(idx) + dv)
    }
  }
  uv.needsUpdate = true
  return geo
}
