import * as THREE from 'three'

/** 创建离屏画布，用于程序化生成纹理 */
export function createCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  return { canvas, ctx }
}

/** 画布转为 three.js 纹理（默认可平铺） */
export function toTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  srgb = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatX, repeatY)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** 草地纹理 */
export function makeGrassTexture(repeat = 48): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(256, 256)
  ctx.fillStyle = '#4e8a3a'
  ctx.fillRect(0, 0, 256, 256)
  const shades = ['#468034', '#579744', '#3f7830', '#5e9f4b']
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = shades[(Math.random() * shades.length) | 0]!
    const x = Math.random() * 256
    const y = Math.random() * 256
    ctx.fillRect(x, y, 2 + Math.random() * 3, 1 + Math.random() * 2)
  }
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#d9e04f' : '#e8eef0'
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
  }
  return toTexture(canvas, repeat * 2.5, repeat * 2.5)
}

/** 沥青路面纹理 */
export function makeAsphaltTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(128, 128)
  ctx.fillStyle = '#3c3f45'
  ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 900; i++) {
    const g = 50 + Math.random() * 40
    ctx.fillStyle = `rgb(${g},${g},${g + 4})`
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5)
  }
  return toTexture(canvas, repeatX, repeatY)
}

/** 石板广场/人行道纹理 */
export function makePavementTexture(repeat = 20): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(256, 256)
  ctx.fillStyle = '#a7abb0'
  ctx.fillRect(0, 0, 256, 256)
  ctx.strokeStyle = 'rgba(70,74,80,0.55)'
  ctx.lineWidth = 2
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath()
    ctx.moveTo((i * 256) / 4, 0)
    ctx.lineTo((i * 256) / 4, 256)
    ctx.moveTo(0, (i * 256) / 4)
    ctx.lineTo(256, (i * 256) / 4)
    ctx.stroke()
  }
  for (let i = 0; i < 700; i++) {
    const g = 150 + Math.random() * 50
    ctx.fillStyle = `rgba(${g},${g},${g},0.35)`
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
  }
  return toTexture(canvas, repeat, repeat)
}

/** 素色墙面纹理（微噪点 + 水平缝线） */
export function makeWallTexture(base: string, repeatX = 4, repeatY = 3): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(128, 128)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, 128, 128)
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'
  ctx.lineWidth = 1
  for (let y = 32; y < 128; y += 32) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(128, y)
    ctx.stroke()
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2)
  }
  return toTexture(canvas, repeatX, repeatY)
}

export interface WindowMaps {
  map: THREE.CanvasTexture
  emissiveMap: THREE.CanvasTexture
}

/**
 * 程序化生成窗户网格纹理：
 * map 为白天外观（蓝天反射玻璃），emissiveMap 为夜晚点亮的窗户（配合 emissive 使用）
 */
export function makeWindowMaps(cols: number, rows: number, litRatio = 0.42): WindowMaps {
  const cell = 64
  const w = Math.min(1024, cols * cell)
  const h = Math.min(1024, rows * cell)
  const cw = w / cols
  const ch = h / rows
  const { canvas, ctx } = createCanvas(w, h)
  const { canvas: eCanvas, ctx: eCtx } = createCanvas(w, h)

  ctx.fillStyle = '#cfcac0'
  ctx.fillRect(0, 0, w, h)
  eCtx.fillStyle = '#000000'
  eCtx.fillRect(0, 0, w, h)

  const glass = ['#2b4d6e', '#315a80', '#274765', '#38668e']
  const mx = cw * 0.18
  const my = ch * 0.2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + mx
      const y = r * ch + my
      const ww = cw - mx * 2
      const hh = ch - my * 2
      // 玻璃 + 顶部天空反光
      const grad = ctx.createLinearGradient(0, y, 0, y + hh)
      grad.addColorStop(0, '#9fc3de')
      grad.addColorStop(0.25, glass[(Math.random() * glass.length) | 0]!)
      grad.addColorStop(1, glass[(Math.random() * glass.length) | 0]!)
      ctx.fillStyle = grad
      ctx.fillRect(x, y, ww, hh)
      ctx.strokeStyle = 'rgba(60,60,66,0.6)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(x, y, ww, hh)
      // 夜晚点亮的窗
      if (Math.random() < litRatio) {
        const warm = eCtx.createLinearGradient(0, y, 0, y + hh)
        warm.addColorStop(0, '#ffe9b0')
        warm.addColorStop(1, '#f5b95a')
        eCtx.fillStyle = warm
        eCtx.fillRect(x, y, ww, hh)
      }
    }
  }
  return { map: toTexture(canvas), emissiveMap: toTexture(eCanvas, 1, 1, false) }
}

/** 文字标签 Sprite（支持中文） */
export function makeLabelSprite(text: string, scale = 16): THREE.Sprite {
  const { canvas, ctx } = createCanvas(512, 128)
  const r = 26
  ctx.fillStyle = 'rgba(10,26,48,0.74)'
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(6, 14, 500, 100, r)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 54px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 256, 68)
  const tex = toTexture(canvas)
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(scale, scale / 4, 1)
  sprite.renderOrder = 20
  return sprite
}

/** 门牌/校名牌子纹理（底色 + 金字） */
export function makeSignTexture(text: string, bg = '#8c1f28', fg = '#f7d774'): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(1024, 160)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 1024, 160)
  ctx.strokeStyle = fg
  ctx.lineWidth = 6
  ctx.strokeRect(10, 10, 1004, 140)
  ctx.fillStyle = fg
  ctx.font = 'bold 96px "Microsoft YaHei", "KaiTi", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 512, 86)
  return toTexture(canvas)
}

/** 云朵 Sprite 纹理（多个径向渐变叠加） */
export function makeCloudTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(256, 256)
  ctx.clearRect(0, 0, 256, 256)
  const blobs = 9
  for (let i = 0; i < blobs; i++) {
    const x = 60 + Math.random() * 136
    const y = 90 + Math.random() * 76
    const r = 34 + Math.random() * 46
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.4)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 五星红旗纹理 */
export function makeFlagTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(180, 120)
  ctx.fillStyle = '#de2910'
  ctx.fillRect(0, 0, 180, 120)

  function star(cx: number, cy: number, R: number, fill: string) {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
      const a2 = a + Math.PI / 5
      const px = cx + R * Math.cos(a)
      const py = cy + R * Math.sin(a)
      const px2 = cx + R * 0.42 * Math.cos(a2)
      const py2 = cy + R * 0.42 * Math.sin(a2)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
      ctx.lineTo(px2, py2)
    }
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
  }
  star(34, 40, 18, '#ffde00')
  star(66, 14, 6, '#ffde00')
  star(78, 32, 6, '#ffde00')
  star(78, 54, 6, '#ffde00')
  star(66, 72, 6, '#ffde00')
  return toTexture(canvas)
}

/** 足球场纹理（草皮条纹 + 白线） */
export function makeSoccerFieldTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(512, 352)
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#3f8f3a' : '#47a044'
    ctx.fillRect((i * 512) / 8, 0, 512 / 8, 352)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.92)'
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
  return toTexture(canvas)
}

/** 篮球场纹理 */
export function makeCourtTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(320, 256)
  ctx.fillStyle = '#4a7d55'
  ctx.fillRect(0, 0, 320, 256)
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
  return toTexture(canvas)
}

/** 钟面纹理 */
export function makeClockTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(256, 256)
  ctx.fillStyle = '#f4f1e8'
  ctx.beginPath()
  ctx.arc(128, 128, 124, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#2b2b2b'
  ctx.lineWidth = 6
  ctx.stroke()
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    const x1 = 128 + Math.cos(a) * 100
    const y1 = 128 + Math.sin(a) * 100
    const x2 = 128 + Math.cos(a) * 112
    const y2 = 128 + Math.sin(a) * 112
    ctx.lineWidth = i % 3 === 0 ? 7 : 3
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  return toTexture(canvas)
}
