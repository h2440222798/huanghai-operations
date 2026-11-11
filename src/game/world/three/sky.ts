import * as THREE from 'three'

import { GLSL_NOISE, GLSL_SKY_COMMON } from './cinematic/glsl'

/**
 * 程序化天空穹顶。
 *
 * 参考项目里最有辨识度的一层就是它：天光渐变 + Mile 散射光晕 + 一层会
 * 被太阳"烧穿"的程序化云海 + 日轮/月轮/星点。全部在着色器里算，没有贴图，
 * 所以可以随昼夜连续变化，也能直接烘成 PMREM 环境贴图给 PBR 材质用。
 */

export interface SkyUniforms {
  [key: string]: { value: unknown }
  uSunDir: { value: THREE.Vector3 }
  uMoonDir: { value: THREE.Vector3 }
  uZen: { value: THREE.Color }
  uHor: { value: THREE.Color }
  uHorAway: { value: THREE.Color }
  uGround: { value: THREE.Color }
  uSunCol: { value: THREE.Color }
  uCloudDark: { value: THREE.Color }
  uCloudLit: { value: THREE.Color }
  uTime: { value: number }
  uCloud: { value: number }
  uNight: { value: number }
  uEnv: { value: number }
  uSunDisk: { value: number }
  uHaze: { value: number }
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;

  uniform vec3 uSunDir, uMoonDir, uZen, uHor, uHorAway, uGround, uSunCol, uCloudDark, uCloudLit;
  uniform float uTime, uCloud, uNight, uEnv, uSunDisk, uHaze;

  ${GLSL_NOISE}
  ${GLSL_SKY_COMMON}

  void main(){
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    float mu = dot(d, uSunDir);
    float s = max(mu, 0.0);
    float ts = skyToSun(d);

    /* ---------------- 晴空底色 + 米氏光晕 ---------------- */
    vec3 sky = mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.42));
    // 地平线附近的大气带（越靠太阳越暖）
    sky = mix(sky, horizonColor(d), exp(-h * 7.5) * (0.55 + 0.45 * uHaze));
    // 太阳周围的光晕：宽晕 + 中晕 + 贴边白热
    float envAtten = 1.0 - uEnv * 0.9;
    sky += uSunCol * (pow(s, 6.0) * 0.16 + pow(s, 180.0) * 0.65 + pow(s, 4000.0) * 7.0) * envAtten;

    /* ---------------- 程序化云海 ---------------- */
    vec2 cuv = d.xz / (h + 0.12) * vec2(0.55, 0.92);
    vec2 q = cuv + vec2(-0.006, 0.002) * uTime;
    float warp = fbm3(q * 0.5 + 7.1);
    vec2 qq = q + (warp - 0.5) * 1.35;
    float dens = fbm5(qq);
    // 被拉长的脊状细节，模拟云底起伏；靠近地平线时衰减，避免高频走样
    float ridg = 1.0 - abs(2.0 * fbm3(qq * 3.0 + 5.0) - 1.0);
    dens = dens * 0.80 + (ridg - 0.6) * 0.22 * smoothstep(0.03, 0.26, h);
    float big = vnoise(q * 0.2 + 3.7);
    float body = dens * 0.74 + big * 0.36;
    float cov = smoothstep(0.52 - uCloud * 0.30, 0.68 - uCloud * 0.24, body);

    // 云层在东方地平线处留出一个燃烧的空隙：太阳永远从缺口烧出来
    float edge = mix(0.020, 0.115, uCloud);
    float rag = (vnoise(q * 0.9 + 11.0) - 0.5) * 0.14 + (dens - 0.5) * 0.10;
    float deck = smoothstep(edge - 0.03, edge + 0.11, h + rag * (0.35 + ts));
    cov *= deck;
    float hole = smoothstep(0.972, 0.9985, mu + (dens - 0.5) * 0.012);
    cov *= 1.0 - 0.93 * hole;

    // 朝太阳方向的密度差 ≈ 云底自阴影，这是"厚"的来源
    vec2 sd = normalize(uSunDir.xz + vec2(1e-5));
    float densS = fbm5(qq + sd * 0.22);
    float relief = clamp((dens - densS) * 4.5 + 0.5, 0.0, 1.0);
    float thick = smoothstep(0.40, 0.72, body);

    vec3 cool = mix(uCloudDark, uCloudDark * 0.42, thick);
    cool *= 0.55 + 0.9 * relief * relief;
    cool += uHor * 0.10 * pow(1.0 - thick, 3.0);

    // 阳光从缺口斜射到云底：靠近太阳、靠近云缘最强
    float nearSun = pow(ts, 5.0) * exp(-max(h - edge, 0.0) * 4.5) + pow(s, 7.0);
    vec3 warm = uCloudLit * nearSun * (0.05 + 2.1 * relief * relief * relief);
    float rim = cov * (1.0 - cov) * 4.0;
    warm += uSunCol * rim * pow(ts, 4.0) * (0.35 + 1.5 * pow(s, 6.0)) * (1.0 - 0.8 * hole);

    vec3 cloudC = cool + warm;
    // 远处云层融进地平线色，形成空气透视
    cloudC = mix(cloudC, horizonColor(d) * 0.55 + cloudC * 0.45, exp(-h * 9.0));

    vec3 col = mix(sky, cloudC, cov * 0.98);

    /* ---------------- 太阳 / 月亮 ---------------- */
    float veil = (1.0 - cov * 0.90) * (1.0 - uEnv);
    float disk = smoothstep(0.999905, 0.999950, mu);
    col += uSunCol * disk * 90.0 * veil * uSunDisk;

    float mm = dot(d, uMoonDir);
    float moon = smoothstep(0.99975, 0.99990, mm);
    col += vec3(0.86, 0.92, 1.0) * moon * 9.0 * (1.0 - uEnv) * uNight;
    col += vec3(0.55, 0.68, 1.0) * pow(max(mm, 0.0), 900.0) * 0.35 * uNight * (1.0 - uEnv);

    /* ---------------- 星空 ---------------- */
    if (uNight > 0.01 && d.y > 0.0) {
      vec2 sp = vec2(atan(d.z, d.x) * 24.0, acos(clamp(d.y, -1.0, 1.0)) * 24.0);
      vec2 cell = floor(sp);
      vec2 f = fract(sp) - 0.5;
      float rnd = hash12(cell);
      float star = step(0.972, rnd) * smoothstep(0.34, 0.02, length(f));
      float tw = 0.55 + 0.45 * sin(uTime * 2.1 + rnd * 40.0);
      col += vec3(0.85, 0.90, 1.0) * star * tw * uNight * smoothstep(0.02, 0.22, d.y) * 2.2;
    }

    /* ---------------- 地平线以下：地面反照 ---------------- */
    if (d.y < 0.0) {
      float t = clamp(-d.y * 4.0, 0.0, 1.0);
      vec3 low = mix(horizonColor(d) * 0.55, uGround, smoothstep(0.0, 0.45, t));
      col = mix(col, low, smoothstep(0.0, 0.10, -d.y));
    }

    // 烘 PMREM 时要防止太阳这种极亮像素变成 firefly
    col = mix(col, min(col, vec3(9.0)), uEnv);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`

export interface Sky {
  group: THREE.Group
  dome: THREE.Mesh
  uniforms: SkyUniforms
  sunLight: THREE.DirectionalLight
  moonLight: THREE.DirectionalLight
  hemiLight: THREE.HemisphereLight
  update: (dt: number, camera?: THREE.Camera) => void
  setEnvMode: (on: boolean) => void
}

const SIZE = 1600

export function createSky(scene: THREE.Scene): Sky {
  const uniforms: SkyUniforms = {
    uSunDir: { value: new THREE.Vector3(0.3, 0.4, -0.8).normalize() },
    uMoonDir: { value: new THREE.Vector3(-0.3, -0.4, 0.8).normalize() },
    uZen: { value: new THREE.Color('#2f6bb0') },
    uHor: { value: new THREE.Color('#ffb071') },
    uHorAway: { value: new THREE.Color('#9db9cf') },
    uGround: { value: new THREE.Color('#2a2620') },
    uSunCol: { value: new THREE.Color('#ffd9a8') },
    uCloudDark: { value: new THREE.Color('#3a4453') },
    uCloudLit: { value: new THREE.Color('#ffb877') },
    uTime: { value: 0 },
    uCloud: { value: 0.55 },
    uNight: { value: 0 },
    uEnv: { value: 0 },
    uSunDisk: { value: 1 },
    uHaze: { value: 0.55 },
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  })

  const dome = new THREE.Mesh(new THREE.SphereGeometry(SIZE, 48, 24), material)
  dome.name = 'skyDome'
  dome.frustumCulled = false
  dome.renderOrder = -1000

  const group = new THREE.Group()
  group.add(dome)
  scene.add(group)

  const sunLight = new THREE.DirectionalLight('#fff2dd', 2.6)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 20
  sunLight.shadow.camera.far = 1400
  sunLight.shadow.camera.left = -185
  sunLight.shadow.camera.right = 185
  sunLight.shadow.camera.top = 185
  sunLight.shadow.camera.bottom = -185
  sunLight.shadow.bias = -0.00018
  sunLight.shadow.normalBias = 0.22
  sunLight.shadow.radius = 1.8
  group.add(sunLight, sunLight.target)

  const moonLight = new THREE.DirectionalLight('#a8bde0', 0.0)
  group.add(moonLight, moonLight.target)

  const hemiLight = new THREE.HemisphereLight('#9dc0ea', '#4a4030', 0.5)
  group.add(hemiLight)

  const update = (dt: number, camera?: THREE.Camera) => {
    uniforms.uTime.value += dt
    if (camera) dome.position.copy(camera.position)
  }

  const setEnvMode = (on: boolean) => {
    uniforms.uEnv.value = on ? 1 : 0
  }

  return { group, dome, uniforms, sunLight, moonLight, hemiLight, update, setEnvMode }
}
