import * as THREE from 'three'
import { makeCloudTexture } from './textures'

/** 天空穹顶着色器：根据太阳高度在顶色/地平线色之间做渐变 */
function makeSkyDome(): { mesh: THREE.Mesh; uniforms: SkyUniforms } {
  const uniforms: SkyUniforms = {
    uTopColor: { value: new THREE.Color('#3f7fce') },
    uHorizonColor: { value: new THREE.Color('#cfe5f5') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunGlow: { value: 0.0 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uSunDir;
      uniform float uSunGlow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizonColor, uTopColor, pow(h, 0.55));
        // 太阳方向的暮光光晕
        float sunAmount = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
        col += uSunGlow * pow(sunAmount, 6.0) * vec3(1.0, 0.55, 0.25) * 0.85;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(850, 32, 16), mat)
  mesh.name = 'skyDome'
  return { mesh, uniforms }
}

interface SkyUniforms {
  [key: string]: { value: unknown }
  uTopColor: { value: THREE.Color }
  uHorizonColor: { value: THREE.Color }
  uSunDir: { value: THREE.Vector3 }
  uSunGlow: { value: number }
}

/** 星空：随机分布在北半球穹顶上的点云 */
function makeStars(): THREE.Points {
  const count = 1400
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // 均匀分布在上半球
    const u = Math.random()
    const v = Math.random() * 0.95 + 0.05
    const theta = u * Math.PI * 2
    const phi = Math.acos(v)
    const r = 820
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 10
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2.2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  })
  const points = new THREE.Points(geo, mat)
  points.renderOrder = 1
  return points
}

/** 太阳 + 月亮（自发光球体 + 光晕 Sprite） */
function makeCelestial(radius: number, color: string, glowColor: string, glowScale: number) {
  const group = new THREE.Group()
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 20, 20),
    new THREE.MeshBasicMaterial({ color, fog: false }),
  )
  group.add(core)

  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const c = cv.getContext('2d')!
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 64)
  g.addColorStop(0, glowColor)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = g
  c.fillRect(0, 0, 128, 128)
  const glowTex = new THREE.CanvasTexture(cv)
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  )
  glow.scale.setScalar(glowScale)
  group.add(glow)
  return group
}

/** 云层：一组飘动的 Sprite */
function makeClouds(): { group: THREE.Group; material: THREE.SpriteMaterial } {
  const material = new THREE.SpriteMaterial({
    map: makeCloudTexture(),
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    fog: false,
  })
  const group = new THREE.Group()
  for (let i = 0; i < 16; i++) {
    const sprite = new THREE.Sprite(material)
    const x = -650 + Math.random() * 1300
    const z = -650 + Math.random() * 1300
    const y = 130 + Math.random() * 120
    sprite.position.set(x, y, z)
    const s = 70 + Math.random() * 110
    sprite.scale.set(s, s * 0.55, 1)
    group.add(sprite)
  }
  return { group, material }
}

export interface Sky {
  group: THREE.Group
  uniforms: SkyUniforms
  sunLight: THREE.DirectionalLight
  moonLight: THREE.DirectionalLight
  hemiLight: THREE.HemisphereLight
  sunMesh: THREE.Group
  moonMesh: THREE.Group
  stars: THREE.Points
  cloudGroup: THREE.Group
  cloudMaterial: THREE.SpriteMaterial
  update: (dt: number) => void
}

/** 组装天空 + 基础光照 */
export function createSky(scene: THREE.Scene): Sky {
  const group = new THREE.Group()
  const { mesh: dome, uniforms } = makeSkyDome()
  group.add(dome)

  const stars = makeStars()
  group.add(stars)

  const sunMesh = makeCelestial(22, '#fff3c4', 'rgba(255,220,130,0.9)', 190)
  const moonMesh = makeCelestial(15, '#dfe6f0', 'rgba(200,215,255,0.55)', 90)
  group.add(sunMesh, moonMesh)

  const { group: cloudGroup, material: cloudMaterial } = makeClouds()
  group.add(cloudGroup)

  const sunLight = new THREE.DirectionalLight('#fff2dd', 2.6)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 20
  sunLight.shadow.camera.far = 900
  const S = 240
  sunLight.shadow.camera.left = -S
  sunLight.shadow.camera.right = S
  sunLight.shadow.camera.top = S
  sunLight.shadow.camera.bottom = -S
  sunLight.shadow.bias = -0.0004
  sunLight.shadow.normalBias = 0.6
  group.add(sunLight, sunLight.target)

  const moonLight = new THREE.DirectionalLight('#b7c8e8', 0.0)
  group.add(moonLight, moonLight.target)

  const hemiLight = new THREE.HemisphereLight('#bcd8ff', '#5c7050', 0.9)
  group.add(hemiLight)

  scene.add(group)

  const update = (dt: number) => {
    // 云缓慢漂移，超出范围后回绕
    for (const child of cloudGroup.children) {
      child.position.x += dt * 3.2
      if (child.position.x > 700) child.position.x = -700
    }
  }

  return {
    group,
    uniforms,
    sunLight,
    moonLight,
    hemiLight,
    sunMesh,
    moonMesh,
    stars,
    cloudGroup,
    cloudMaterial,
    update,
  }
}
