import * as THREE from 'three'

import {
  fieldMaterial,
  courtMaterial,
  leafMaterial,
  metalMaterial,
  paint,
  paintedStone,
  paverMaterial,
  stoneMaterial,
  tintedRoof,
  trackMaterial,
  woodMaterial,
} from './materials'
import { makeFlagTexture } from './textures'
import { scaleUv } from './procedural'
import { createBirdFlock, type BirdFlock } from './realBirds'

/** 喷泉：石质水池 + 中心水柱（顶点脉冲动画） */
export function makeFountain(x: number, z: number): { group: THREE.Group; update: (t: number) => void } {
  const g = new THREE.Group()
  const stoneMat = paintedStone('#c6c2b7')
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.6, 1.1, 40), stoneMat)
  basin.position.y = 0.55
  basin.castShadow = true
  basin.receiveShadow = true
  g.add(basin)
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(6.3, 6.3, 0.3, 40), stoneMat)
  inner.position.y = 1.0
  g.add(inner)

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(6.3, 40),
    new THREE.MeshPhysicalMaterial({
      color: '#2f7fa8',
      transparent: true,
      opacity: 0.72,
      roughness: 0.05,
      metalness: 0.05,
      envMapIntensity: 1.6,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
    }),
  )
  water.rotation.x = -Math.PI / 2
  water.position.y = 1.18
  g.add(water)

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 1.6, 20), stoneMat)
  pedestal.position.y = 1.9
  pedestal.castShadow = true
  g.add(pedestal)

  // 水柱（略带锥度的圆柱，动画里拉伸 + 旋转）
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.8, 4.6, 16, 1, true),
    new THREE.MeshPhysicalMaterial({
      color: '#eaf6ff',
      transparent: true,
      opacity: 0.5,
      roughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.5,
    }),
  )
  jet.position.y = 4.4
  g.add(jet)
  const jetTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 14, 14),
    new THREE.MeshPhysicalMaterial({
      color: '#eaf6ff',
      transparent: true,
      opacity: 0.4,
      roughness: 0.05,
      depthWrite: false,
      envMapIntensity: 1.5,
    }),
  )
  jetTop.position.y = 6.9
  g.add(jetTop)

  g.position.set(x, 0, z)
  const update = (t: number) => {
    const s = 1 + Math.sin(t * 2.4) * 0.08
    jet.scale.set(1, s, 1)
    jet.rotation.y = t * 0.6
    jetTop.position.y = 4.4 + 2.5 * s + 0.3
    jetTop.scale.setScalar(0.9 + Math.sin(t * 3.1) * 0.12)
  }
  return { group: g, update }
}

/** 旗帜：顶点着色器波动（默认五star红旗或纯色旗） */
export function makeFlagpole(
  x: number,
  z: number,
  h: number,
  flagColor: string | null,
): { group: THREE.Group; update: (t: number) => void } {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, h, 10), metalMaterial())
  pole.position.y = h / 2
  pole.castShadow = true
  g.add(pole)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), paint('#d9b23a', 0.25, 0.85))
  knob.position.y = h + 0.1
  g.add(knob)

  let update = (_t: number) => {}
  if (flagColor) {
    const geo = new THREE.PlaneGeometry(5, 3.3, 20, 8)
    geo.translate(2.5, 0, 0)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: flagColor === 'flag' ? makeFlagTexture() : makeSolidFlagTexture(flagColor) },
      },
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vShade;
        void main() {
          vUv = uv;
          vec3 p = position;
          float wave = sin(p.x * 1.7 - uTime * 5.0) * 0.32
                     + sin(p.x * 3.3 - uTime * 7.3) * 0.12;
          float reach = pow(p.x / 5.0, 1.1);
          p.z += wave * reach;
          p.y += cos(p.x * 1.3 - uTime * 4.0) * 0.1 * reach;
          vShade = 0.82 + 0.18 * cos(wave * 2.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vShade;
        void main() {
          vec4 col = texture2D(uMap, vUv);
          gl_FragColor = vec4(col.rgb * vShade, 1.0);
        }
      `,
    })
    const flag = new THREE.Mesh(geo, mat)
    flag.position.y = h - 2.2
    flag.castShadow = true
    g.add(flag)
    update = (t: number) => {
      mat.uniforms.uTime!.value = t
    }
  }
  g.position.set(x, 0, z)
  return { group: g, update }
}

function makeSolidFlagTexture(color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 42
  const c = cv.getContext('2d')!
  c.fillStyle = color
  c.fillRect(0, 0, 64, 42)
  c.fillStyle = 'rgba(255,255,255,0.85)'
  c.beginPath()
  c.arc(32, 21, 9, 0, Math.PI * 2)
  c.fill()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * 小鸟群：优先加载 public/models/birds 下的真实 GLB 模型（海鸥 / 麻雀 / 蓝鸲 / 白鹳 / 鹰）。
 * 模型加载完成前不显示鸟；若加载失败则回退到原来的程序化飞鸟，保证页面不缺元素。
 */
export function makeBirds(
  center: THREE.Vector2,
  count = 6,
  perches?: { x: number; z: number; y?: number }[],
): {
  group: THREE.Group
  update: (t: number) => void
} {
  const group = new THREE.Group()
  let fallback: ReturnType<typeof makeProceduralBirds> | null = null
  let flock: BirdFlock | null = null
  let disposed = false

  const ensureFallback = () => {
    if (disposed || group.parent === null || fallback) return
    fallback = makeProceduralBirds(center, count)
    group.add(fallback.group)
  }

  void createBirdFlock({ center, count, perches })
    .then((real) => {
      if (disposed || group.parent === null) {
        real?.dispose()
        return
      }
      if (!real || real.birdCount === 0) {
        real?.dispose()
        ensureFallback()
        return
      }
      flock = real
      group.add(real.group)
    })
    .catch((error) => {
      console.warn('[campus-birds] 真实小鸟加载失败，回退到程序化飞鸟', error)
      ensureFallback()
    })

  const update = (t: number) => {
    if (flock) flock.update(t)
    else fallback?.update(t)
  }
  return { group, update }
}

/** 程序化飞鸟（模型加载失败时的后备） */
function makeProceduralBirds(center: THREE.Vector2, count = 6): {
  group: THREE.Group
  update: (t: number) => void
} {
  const g = new THREE.Group()
  const mat = paint('#37414d', 0.9, 0)
  mat.side = THREE.DoubleSide
  const wingGeo = new THREE.PlaneGeometry(1.5, 0.55)
  wingGeo.translate(0.75, 0, 0)
  const birds: { group: THREE.Group; wings: THREE.Mesh[]; r: number; y: number; speed: number; phase: number }[] = []
  for (let i = 0; i < count; i++) {
    const b = new THREE.Group()
    const wings: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, mat)
      w.scale.x = side
      w.rotation.z = side * 0.25
      wings.push(w)
      b.add(w)
    }
    g.add(b)
    birds.push({
      group: b,
      wings,
      r: 24 + Math.random() * 22,
      y: 26 + Math.random() * 14,
      speed: 0.25 + Math.random() * 0.18,
      phase: Math.random() * Math.PI * 2,
    })
  }
  g.position.set(center.x, 0, center.y)
  const update = (t: number) => {
    birds.forEach((b, i) => {
      const a = t * b.speed + b.phase
      b.group.position.set(Math.cos(a) * b.r, b.y + Math.sin(t * 0.7 + i) * 1.5, Math.sin(a) * b.r)
      b.group.rotation.y = -a - Math.PI / 2
      const flap = Math.sin(t * 9 + b.phase * 3) * 0.55
      b.wings[0]!.rotation.y = flap
      b.wings[1]!.rotation.y = -flap
    })
  }
  return { group: g, update }
}

/** 长椅 */
export function makeBench(rotY = 0): THREE.Group {
  const g = new THREE.Group()
  const wood = woodMaterial()
  const metal = metalMaterial()
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.6), wood)
  seat.position.y = 0.55
  seat.castShadow = true
  g.add(seat)
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.1), wood)
  back.position.set(0, 0.95, -0.3)
  back.rotation.x = -0.15
  back.castShadow = true
  g.add(back)
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.55), metal)
    leg.position.set(sx * 1.0, 0.28, 0)
    leg.castShadow = true
    g.add(leg)
  }
  g.rotation.y = rotY
  return g
}

/** 田径场：红色塑胶跑道（白线分道）+ 足球场 + 球门 + 看台 */
export function makePlayground(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const SX = 1.38
  const trackGeo = new THREE.RingGeometry(17, 23, 72).rotateX(-Math.PI / 2)
  scaleUv(trackGeo, 4, 4)
  const track = new THREE.Mesh(trackGeo, trackMaterial())
  track.scale.x = SX
  track.position.set(x, 0.1, z)
  track.receiveShadow = true
  g.add(track)

  // 分道线
  const lineMat = paint('#eef0ea', 0.7, 0)
  for (const r of [18.2, 19.9, 21.6]) {
    const line = new THREE.Mesh(new THREE.RingGeometry(r - 0.09, r + 0.09, 72), lineMat)
    line.rotation.x = -Math.PI / 2
    line.scale.x = SX
    line.position.set(x, 0.125, z)
    g.add(line)
  }

  // 内场足球场
  const field = new THREE.Mesh(new THREE.CircleGeometry(17, 56), fieldMaterial())
  field.rotation.x = -Math.PI / 2
  field.scale.set(SX, 1, 1)
  field.position.set(x, 0.105, z)
  field.receiveShadow = true
  g.add(field)

  // 球门
  const goalMat = paint('#f2f2f2', 0.5, 0.1)
  for (const gx of [-14.5, 14.5]) {
    const goal = new THREE.Group()
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 7.3), goalMat)
    bar.position.y = 2.44
    goal.add(bar)
    for (const gz of [-3.65, 3.65]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.44, 0.16), goalMat)
      post.position.set(0, 1.22, gz)
      goal.add(post)
    }
    goal.position.set(x + gx * SX, 0, z)
    goal.traverse((o) => ((o as THREE.Mesh).castShadow = true))
    g.add(goal)
  }

  // 简易看台
  const standMat = paintedStone('#cfc9bb')
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2, 0.55, 26), standMat)
    step.position.set(x - 26 - i * 1.9, 0.35 + i * 0.55, z)
    step.castShadow = true
    step.receiveShadow = true
    g.add(step)
  }
  return g
}

/** 篮球场：场地 + 篮架 */
export function makeBasketballCourt(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const court = new THREE.Mesh(new THREE.PlaneGeometry(16, 13), courtMaterial())
  court.rotation.x = -Math.PI / 2
  court.position.set(x, 0.11, z)
  court.receiveShadow = true
  g.add(court)

  const poleMat = metalMaterial()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 3.8, 10), poleMat)
  pole.position.set(x + 9, 1.9, z)
  pole.castShadow = true
  g.add(pole)
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1.1, 1.8),
    paint('#e8eaec', 0.35, 0.1),
  )
  board.position.set(x + 8.1, 3.55, z)
  board.castShadow = true
  g.add(board)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.035, 8, 24),
    paint('#d9532f', 0.35, 0.55),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.set(x + 7.6, 3.15, z)
  g.add(ring)
  return g
}

/** 湖心亭：石台 + 六柱 + 攒尖顶 */
export function makePavilion(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.55, 8), stoneMaterial())
  platform.position.y = 1.35
  platform.castShadow = true
  platform.receiveShadow = true
  g.add(platform)
  const colMat = paint('#9a3b2e', 0.62, 0.05)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 2.9, 12), colMat)
    col.position.set(Math.cos(a) * 2.7, 1.6 + 1.45, Math.sin(a) * 2.7)
    col.castShadow = true
    g.add(col)
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 1.9, 8), tintedRoof('#5d4436'))
  roof.position.y = 4.75
  roof.castShadow = true
  g.add(roof)
  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 12),
    paint('#d9b23a', 0.25, 0.8),
  )
  finial.position.y = 5.8
  g.add(finial)
  g.position.set(x, 0, z)
  return g
}

/** 建筑入口的小路 */
export function makePath(
  from: THREE.Vector2,
  to: THREE.Vector2,
  width: number,
): THREE.Mesh {
  const dir = new THREE.Vector2(to.x - from.x, to.y - from.y)
  const len = dir.length()
  const geo = new THREE.PlaneGeometry(width, len + width * 0.4).rotateX(-Math.PI / 2)
  scaleUv(geo, width / 3, len / 3)
  const mesh = new THREE.Mesh(geo, paverMaterial())
  mesh.rotation.y = -Math.atan2(dir.y, dir.x)
  mesh.position.set((from.x + to.x) / 2, 0.12, (from.y + to.y) / 2)
  mesh.receiveShadow = true
  return mesh
}

/** 绿篱：一道修剪整齐的灌木，给建筑和道路镶边 */
export function makeHedge(x: number, z: number, length: number, rotY = 0, height = 0.95): THREE.Mesh {
  const geo = new THREE.BoxGeometry(length, height, 0.9)
  scaleUv(geo, length / 1.5, height / 1.5)
  const mesh = new THREE.Mesh(geo, leafMaterial())
  mesh.position.set(x, height / 2, z)
  mesh.rotation.y = rotY
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/** 树下 / 广场边的花钵 */
export function makePlanter(x: number, z: number): THREE.Group {
  const g = new THREE.Group()
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.6, 0.8, 12), paintedStone('#cfc9bd'))
  pot.position.y = 0.4
  pot.castShadow = true
  g.add(pot)
  const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), leafMaterial())
  bush.position.y = 1.15
  bush.scale.set(1.1, 0.85, 1.1)
  bush.castShadow = true
  g.add(bush)
  g.position.set(x, 0, z)
  return g
}
