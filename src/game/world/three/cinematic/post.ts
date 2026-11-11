import * as THREE from 'three'

import { FULLSCREEN_VERT, GLSL_DEPTH, GLSL_NOISE, GLSL_TONE } from './glsl'

/**
 * 电影级后期管线。
 *
 * 参考项目的画面之所以像"3A"，很大一部分来自这条链：
 *   HDR 场景 → 半分辨率 SSAO → 体积光束 → 多级泛光 → AgX/ACES 合成
 *   （含镜头污渍、太阳耀斑、色散、暗角、颗粒）→ FXAA
 * 并且整条链在 HDR 线性空间里跑，最后才做一次色调映射。
 *
 * 另外这里还接管了"大气透视"：three 的 Fog 是均匀的，做不出逆光时地平线
 * 那一层暖雾；所以场景不设 fog，而是在合成阶段按深度 + 视线方向解析计算。
 */

export type PostQuality = 'low' | 'medium' | 'high' | 'ultra'

export interface PostFrameState {
  time: number
  dt: number
  sunDir: THREE.Vector3
  sunColor: THREE.Color
  /** 太阳是否在地平线上（0/1） */
  sunOn: number
  /** 雾/大气颜色（背光侧） */
  fogColor: THREE.Color
  /** 雾/大气颜色（朝阳侧，暖） */
  fogSun: THREE.Color
  fogDensity: number
  fogHeight: number
  exposure: number
  bloom: number
  shafts: number
  vignette: number
  grain: number
  saturation: number
  fade: number
  night: number
}

const QUALITY_SETTINGS: Record<PostQuality, { aoTaps: number; ao: boolean; shafts: boolean; bloomLevels: number; maxPixelRatio: number }> = {
  low: { aoTaps: 6, ao: false, shafts: false, bloomLevels: 2, maxPixelRatio: 1 },
  medium: { aoTaps: 8, ao: true, shafts: false, bloomLevels: 3, maxPixelRatio: 1.25 },
  high: { aoTaps: 12, ao: true, shafts: true, bloomLevels: 4, maxPixelRatio: 1.75 },
  ultra: { aoTaps: 16, ao: true, shafts: true, bloomLevels: 5, maxPixelRatio: 2 },
}

class FullScreenPass {
  readonly material: THREE.ShaderMaterial
  private mesh: THREE.Mesh
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  constructor(renderer: THREE.WebGLRenderer, fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: false,
    })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, clear = true) {
    renderer.setRenderTarget(target)
    if (clear) {
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)
    }
    renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}

const AO_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform vec2 uTexel, uTanHalf;
  uniform float uRadius, uIntensity, uAspect;
  ${GLSL_NOISE}
  ${GLSL_DEPTH}

  vec3 vpos(vec2 uv, float z){ return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }

  void main(){
    float z0 = viewZ(texture2D(tDepth, vUv).r);
    if (z0 > 420.0) { gl_FragColor = vec4(1.0); return; }
    vec3 P = vpos(vUv, z0);
    // 由相邻像素的深度差重建法线：不需要 G-buffer，代价只有 4 次采样
    vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
    float zl = viewZ(texture2D(tDepth, vUv - ox).r);
    float zr = viewZ(texture2D(tDepth, vUv + ox).r);
    float zd = viewZ(texture2D(tDepth, vUv - oy).r);
    float zu = viewZ(texture2D(tDepth, vUv + oy).r);
    vec3 dx = abs(zl - z0) < abs(zr - z0) ? P - vpos(vUv - ox, zl) : vpos(vUv + ox, zr) - P;
    vec3 dy = abs(zd - z0) < abs(zu - z0) ? P - vpos(vUv - oy, zd) : vpos(vUv + oy, zu) - P;
    vec3 n = normalize(cross(dx, dy));

    float R = uRadius * (0.65 + 0.35 * clamp(z0 / 14.0, 0.0, 1.0));
    float rUv = clamp(R / (2.0 * z0 * uTanHalf.y), 2.0 * uTexel.y, 0.10);
    float R2 = R * R;
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    float sum = 0.0;
    for (int i = 0; i < AO_TAPS; i++) {
      float a = (float(i) + 0.5) / float(AO_TAPS);
      float th = a * 6.2831853 * 3.0 + rot;
      vec2 o = vec2(cos(th), sin(th)) * a * rUv;
      o.x /= uAspect;
      vec2 uv2 = vUv + o;
      float z2 = viewZ(texture2D(tDepth, uv2).r);
      vec3 v = vpos(uv2, z2) - P;
      float vv = dot(v, v);
      float vn = dot(v, n);
      float f = max(R2 - vv, 0.0);
      sum += f * f * f * max((vn - (0.012 + 0.004 * z0)) / (vv + 0.004), 0.0);
    }
    float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (R2 * R2 * R2 * float(AO_TAPS)));
    ao = mix(ao, 1.0, smoothstep(220.0, 420.0, z0));
    gl_FragColor = vec4(ao, ao, ao, 1.0);
  }
`

const SHAFT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tDepth;
  uniform vec2 uSunUv;
  uniform float uSunOn, uIntensity, uAspect, uThreshold, uNight;
  ${GLSL_NOISE}

  // 屏幕空间太阳光束：沿"像素→太阳"方向累积明亮的天空像素。
  // 不是真正的体积散射，但在逆光场景里观感非常接近，且只要 24 次采样。
  void main(){
    if (uSunOn < 0.001) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    vec2 delta = (uSunUv - vUv) / 24.0;
    vec2 uv = vUv;
    float j = ign(gl_FragCoord.xy) * 0.9 + 0.05;
    uv += delta * j;
    vec3 acc = vec3(0.0);
    float w = 1.0;
    float wsum = 0.0;
    for (int i = 0; i < 24; i++) {
      vec3 c = texture2D(tScene, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
      float d = texture2D(tDepth, clamp(uv, vec2(0.001), vec2(0.999))).r;
      float sky = step(0.99985, d);
      float b = max(luma(c) - uThreshold, 0.0);
      acc += c * b * w * mix(0.12, 1.0, sky);
      wsum += w;
      w *= 0.955;
      uv += delta;
    }
    acc /= max(wsum, 1e-4);
    gl_FragColor = vec4(acc * uIntensity * mix(0.55, 1.0, uNight), 1.0);
  }
`

const BLOOM_PRE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform float uThreshold, uSoftKnee;
  ${GLSL_NOISE}
  void main(){
    vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(80.0));
    float br = max(c.r, max(c.g, c.b));
    float knee = uThreshold * uSoftKnee + 1e-4;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
    gl_FragColor = vec4(c * contrib, 1.0);
  }
`

const BLOOM_DOWN_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uFirst;
  ${GLSL_NOISE}
  vec3 s(vec2 o){ return min(max(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(0.0)), vec3(80.0)); }
  float kw(vec3 c){ return 1.0 / (1.0 + luma(c) * 0.08); }
  void main(){
    vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
    vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
    vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
    vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
    vec3 col;
    if (uFirst > 0.5) {
      // 第一次降采样做 Karis 平均，压掉单像素 firefly 又不至于熄灭太阳
      vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25;
      vec3 g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
      float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
      col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
    } else {
      col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`

const BLOOM_UP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tLow;
  uniform vec2 uTexel;
  uniform float uScale;
  void main(){
    vec2 o = uTexel;
    vec3 t = texture2D(tLow, vUv).rgb * 4.0;
    t += (texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.0)).rgb
        + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb + texture2D(tLow, vUv - vec2(0.0, o.y)).rgb) * 2.0;
    t += texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb
       + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
    t *= uScale / 16.0;
    gl_FragColor = vec4(t, 1.0);
  }
`

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tScene, tBloom, tAO, tShaft, tDepth;
  uniform vec2 uRes, uHalfRes, uSunUv;
  uniform mat4 uInvViewProj;
  uniform vec3 uCamPos, uSunCol, uFogColor, uFogSun, uSunDir;
  uniform float uAspect, uTime, uExposure, uBloom, uShafts, uVignette, uCA, uGrain;
  uniform float uSaturation, uFade, uNight, uFogDensity, uFogHeight, uAoOn, uAoStrength, uSunOn;
  ${GLSL_NOISE}
  ${GLSL_TONE}
  ${GLSL_DEPTH}

  float skyToSun(vec3 d){
    vec2 a = normalize(d.xz + vec2(1e-5));
    vec2 b = normalize(uSunDir.xz + vec2(1e-5));
    return clamp(dot(a, b) * 0.5 + 0.5, 0.0, 1.0);
  }

  vec3 flare(vec2 uv, vec2 sun, float vis){
    vec2 asp = vec2(uAspect, 1.0);
    vec2 p = (uv - 0.5) * asp;
    vec2 s = (sun - 0.5) * asp;
    vec2 dv = p - s;
    float r = length(dv);
    vec3 c = vec3(0.0);
    float ang = atan(dv.y, dv.x);
    float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 24.0) + 0.6 * pow(abs(cos(ang * 4.0 - 1.1)), 40.0);
    // 遮光眩光 + 柔和衍射星芒（强度压住，别把画面糊白）
    c += uSunCol * (0.010 / (r * r * 9.0 + 0.010) + 0.055 * exp(-r * 3.6));
    c += uSunCol * spikes * 0.16 * exp(-r * 6.0);
    // 太阳—画面中心连线上的鬼影（小、淡，避免盖住枪模）
    vec3 g = vec3(0.0);
    float k0 = length(p + s * 0.38);  g += vec3(0.30, 0.75, 0.55) * smoothstep(0.048, 0.032, k0) * 0.030;
    float k1 = length(p + s * 0.82);  g += vec3(0.85, 0.45, 0.25) * smoothstep(0.026, 0.016, k1) * 0.045;
    float k2 = length(p + s * 1.35);  g += vec3(0.35, 0.50, 0.95) * smoothstep(0.090, 0.065, k2) * 0.022;
    float k3 = length(p - s * 0.45);  g += vec3(0.80, 0.70, 0.35) * smoothstep(0.018, 0.010, k3) * 0.040;
    float hr = length(p + s * 0.15);
    g += vec3(0.45, 0.55, 0.85) * exp(-pow((hr - 0.52) * 16.0, 2.0)) * 0.020 * smoothstep(0.1, 0.5, length(s));
    c += g * uSunCol * 1.6;
    return c * vis;
  }

  void main(){
    vec2 c = vUv - 0.5;
    vec2 ac = c * vec2(uAspect, 1.0);
    float r2 = dot(ac, ac) / (0.25 * (uAspect * uAspect + 1.0));

    // 径向色散（很轻，只在边缘可见）
    vec2 off = c * r2 * uCA;
    vec3 col = vec3(
      texture2D(tScene, vUv + off).r,
      texture2D(tScene, vUv).g,
      texture2D(tScene, vUv - off).b
    );

    float d = texture2D(tDepth, vUv).r;
    float z = viewZ(min(d, 0.999999));

    /* ---------------- 大气透视（按深度解析积分） ---------------- */
    if (d < 0.99999) {
      vec4 wp4 = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec3 wp = wp4.xyz / max(wp4.w, 1e-6);
      vec3 rd = normalize(wp - uCamPos);
      float dist = length(wp - uCamPos);
      // 指数高度雾：低处浓、高处淡；沿视线取平均高度，成本比真体积积分低两个数量级
      float hAvg = max(0.5 * (uCamPos.y + wp.y), 0.0);
      float tau = uFogDensity * dist * exp(-hAvg / uFogHeight);
      float f = 1.0 - exp(-tau);
      float ts = skyToSun(rd);
      vec3 fogCol = mix(uFogColor, uFogSun, pow(ts, 4.0));
      col = mix(col, fogCol, clamp(f, 0.0, 0.92));
    }

    /* ---------------- SSAO（半分辨率联合双边升采样） ---------------- */
    if (uAoOn > 0.5 && d < 0.99999) {
      vec2 hp = vUv * uHalfRes - 0.5;
      vec2 fr = fract(hp);
      vec2 base = (floor(hp) + 0.5) / uHalfRes;
      vec2 tx = 1.0 / uHalfRes;
      float ao = 0.0;
      float ws = 0.0;
      float zc = min(z, 300.0);
      for (int k = 0; k < 4; k++) {
        vec2 o = vec2(float(k & 1), float(k >> 1));
        vec2 uv = base + o * tx;
        float zh = min(viewZ(texture2D(tDepth, uv).r), 300.0);
        float w = (o.x > 0.5 ? fr.x : 1.0 - fr.x) * (o.y > 0.5 ? fr.y : 1.0 - fr.y);
        w *= 1.0 / (0.015 + abs(zh - zc) / max(zc, 1e-3));
        w = max(w, 1e-5);
        ao += texture2D(tAO, uv).r * w;
        ws += w;
      }
      ao /= ws;
      float lit = smoothstep(0.16, 0.85, luma(col) * uExposure);
      float a = mix(1.0, ao, uAoStrength * (1.0 - 0.8 * lit));
      col *= mix(vec3(a), vec3(1.0), vec3(0.0, 0.03, 0.07));
    }

    /* ---------------- 泛光 + 光束 ---------------- */
    vec3 bloom = texture2D(tBloom, vUv).rgb;
    col += bloom * uBloom;
    col += texture2D(tShaft, vUv).rgb * uShafts * vec3(1.0, 0.86, 0.68);

    // 太阳耀斑：被遮挡时（太阳不在天空像素上）自动消失
    float vis = uSunOn * step(0.99985, texture2D(tDepth, clamp(uSunUv, vec2(0.001), vec2(0.999))).r);
    if (vis > 0.002) col += flare(vUv, uSunUv, vis) * 0.9;

    col = max(col, vec3(0.0));

    /* ---------------- 色调映射 ---------------- */
    col *= uExposure;
    col = mix(slAces(col), slAgx(col), 0.62);

    /* ---------------- 调色 ---------------- */
    float l = luma(col);
    vec3 sh = vec3(0.90, 1.00, 1.06), hi = vec3(1.06, 1.0, 0.94);
    col *= mix(sh, hi, smoothstep(0.03, 0.55, l));
    col = mix(col, col * col * (3.0 - 2.0 * col), 0.28);
    col = col * 0.996 + vec3(0.0025, 0.0035, 0.0045);

    l = luma(col);
    col = mix(vec3(l), col, uSaturation);

    // 暗角
    float vig = uVignette;
    float vr = smoothstep(0.10, 1.05, r2);
    col *= 1.0 - vig * vr * vr * (3.0 - 2.0 * vr);

    col *= 1.0 - uFade;
    col = toSRGB(clamp(col, 0.0, 1.0));

    // 胶片颗粒（在 display space 加，避免暗部被放大）
    float g = (ign(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5);
    col += g * uGrain * (1.0 - 0.6 * luma(col));

    gl_FragColor = vec4(col, luma(col));
  }
`

const FXAA_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uSharpen;
  void main(){
    vec4 M = texture2D(tSrc, vUv);
    vec3 col = M.rgb;
    vec4 NW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel);
    vec4 NE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel);
    vec4 SW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel);
    vec4 SE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel);
    float lMin = min(M.a, min(min(NW.a, NE.a), min(SW.a, SE.a)));
    float lMax = max(M.a, max(max(NW.a, NE.a), max(SW.a, SE.a)));
    float contrast = lMax - lMin;
    if (contrast > max(0.0312, lMax * 0.10)) {
      vec2 dir = vec2(-((NW.a + NE.a) - (SW.a + SE.a)), (NW.a + SW.a) - (NE.a + SE.a));
      float dirReduce = max((NW.a + NE.a + SW.a + SE.a) * 0.03125, 0.0078125);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
      vec4 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
      vec4 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5) + texture2D(tSrc, vUv + dir * 0.5));
      col = (B.a < lMin || B.a > lMax) ? A.rgb : B.rgb;
    }
    if (uSharpen > 0.001) {
      vec3 blur = (texture2D(tSrc, vUv + vec2(0.0, 1.0) * uTexel).rgb
                 + texture2D(tSrc, vUv + vec2(0.0, -1.0) * uTexel).rgb
                 + texture2D(tSrc, vUv + vec2(1.0, 0.0) * uTexel).rgb
                 + texture2D(tSrc, vUv + vec2(-1.0, 0.0) * uTexel).rgb) * 0.25;
      col += (col - blur) * uSharpen;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`

export class CinematicPost {
  private renderer: THREE.WebGLRenderer
  private camera: THREE.PerspectiveCamera
  private quality: PostQuality
  private settings: (typeof QUALITY_SETTINGS)[PostQuality]

  private sceneRT!: THREE.WebGLRenderTarget
  private compRT!: THREE.WebGLRenderTarget
  private aoRT!: THREE.WebGLRenderTarget
  private shaftRT!: THREE.WebGLRenderTarget
  private bloomMips: THREE.WebGLRenderTarget[] = []

  private aoPass!: FullScreenPass
  private shaftPass!: FullScreenPass
  private prePass!: FullScreenPass
  private downPass!: FullScreenPass
  private upPass!: FullScreenPass
  private compPass!: FullScreenPass
  private fxaaPass!: FullScreenPass

  private width = 1
  private height = 1
  private sunUv = new THREE.Vector2(0.5, 0.5)
  private invViewProj = new THREE.Matrix4()
  private tmpV = new THREE.Vector3()

  constructor(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, quality: PostQuality = 'high') {
    this.renderer = renderer
    this.camera = camera
    this.quality = quality
    this.settings = QUALITY_SETTINGS[quality]
    this.buildPasses()
  }

  get renderScaleCap() {
    return this.settings.maxPixelRatio
  }

  private buildPasses() {
    const { aoTaps } = this.settings
    this.aoPass = new FullScreenPass(this.renderer, AO_FRAG, {
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uTanHalf: { value: new THREE.Vector2() },
      uRadius: { value: 1.05 },
      uIntensity: { value: 1.15 },
      uAspect: { value: 1 },
      uNear: { value: this.camera.near },
      uFar: { value: this.camera.far },
    })
    this.aoPass.material.defines = { AO_TAPS: aoTaps }

    this.shaftPass = new FullScreenPass(this.renderer, SHAFT_FRAG, {
      tScene: { value: null },
      tDepth: { value: null },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uSunOn: { value: 0 },
      uIntensity: { value: 1 },
      uAspect: { value: 1 },
      uThreshold: { value: 1.1 },
      uNight: { value: 0 },
    })

    this.prePass = new FullScreenPass(this.renderer, BLOOM_PRE_FRAG, {
      tSrc: { value: null },
      uThreshold: { value: 1.0 },
      uSoftKnee: { value: 0.6 },
    })

    this.downPass = new FullScreenPass(this.renderer, BLOOM_DOWN_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uFirst: { value: 0 },
    })

    this.upPass = new FullScreenPass(this.renderer, BLOOM_UP_FRAG, {
      tLow: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uScale: { value: 1 },
    })
    this.upPass.material.blending = THREE.AdditiveBlending
    this.upPass.material.transparent = true
    this.upPass.material.depthTest = false

    this.compPass = new FullScreenPass(this.renderer, COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      tAO: { value: null },
      tShaft: { value: null },
      tDepth: { value: null },
      uRes: { value: new THREE.Vector2() },
      uHalfRes: { value: new THREE.Vector2() },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogColor: { value: new THREE.Color(0.5, 0.6, 0.7) },
      uFogSun: { value: new THREE.Color(1, 0.8, 0.6) },
      uAspect: { value: 1 },
      uTime: { value: 0 },
      uExposure: { value: 0.62 },
      uBloom: { value: 0.55 },
      uShafts: { value: 0.5 },
      uVignette: { value: 0.32 },
      uCA: { value: 0.0016 },
      uGrain: { value: 0.022 },
      uSaturation: { value: 1.06 },
      uFade: { value: 0 },
      uNight: { value: 0 },
      uAoOn: { value: this.settings.ao ? 1 : 0 },
      uAoStrength: { value: 0.85 },
      uSunOn: { value: 0 },
      uFogDensity: { value: 0.0015 },
      uFogHeight: { value: 55 },
      uNear: { value: this.camera.near },
      uFar: { value: this.camera.far },
    })

    this.fxaaPass = new FullScreenPass(this.renderer, FXAA_FRAG, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uSharpen: { value: 0.18 },
    })
  }

  setQuality(q: PostQuality) {
    if (q === this.quality) return
    this.quality = q
    this.settings = QUALITY_SETTINGS[q]
    this.aoPass.material.defines = { AO_TAPS: this.settings.aoTaps }
    this.aoPass.material.needsUpdate = true
    this.compPass.material.uniforms.uAoOn!.value = this.settings.ao ? 1 : 0
    if (this.width > 1) this.setSize(this.width, this.height)
  }

  setSize(width: number, height: number) {
    const w = Math.max(2, Math.floor(width))
    const h = Math.max(2, Math.floor(height))
    if (w === this.width && h === this.height && this.sceneRT) return
    this.width = w
    this.height = h
    this.disposeTargets()

    const depthTexture = new THREE.DepthTexture(w, h)
    depthTexture.type = THREE.UnsignedIntType
    depthTexture.format = THREE.DepthFormat
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter

    this.sceneRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      depthTexture,
      stencilBuffer: false,
    })
    this.sceneRT.texture.colorSpace = THREE.LinearSRGBColorSpace
    this.sceneRT.texture.generateMipmaps = false

    this.compRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    })
    this.compRT.texture.colorSpace = THREE.NoColorSpace

    const hw = Math.max(1, Math.floor(w / 2))
    const hh = Math.max(1, Math.floor(h / 2))
    this.aoRT = new THREE.WebGLRenderTarget(hw, hh, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    })
    this.aoRT.texture.colorSpace = THREE.NoColorSpace
    this.shaftRT = new THREE.WebGLRenderTarget(hw, hh, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    })
    this.shaftRT.texture.colorSpace = THREE.LinearSRGBColorSpace

    this.bloomMips = []
    let mw = hw
    let mh = hh
    for (let i = 0; i < this.settings.bloomLevels; i++) {
      const rt = new THREE.WebGLRenderTarget(Math.max(1, mw), Math.max(1, mh), {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
      })
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace
      this.bloomMips.push(rt)
      mw = Math.floor(mw / 2)
      mh = Math.floor(mh / 2)
    }
  }

  private disposeTargets() {
    this.sceneRT?.depthTexture?.dispose()
    this.sceneRT?.dispose()
    this.compRT?.dispose()
    this.aoRT?.dispose()
    this.shaftRT?.dispose()
    for (const m of this.bloomMips) m.dispose()
    this.bloomMips = []
  }

  /** 渲染一帧并直接输出到画布 */
  render(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    state: PostFrameState,
    overlay?: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null,
  ) {
    const renderer = this.renderer
    const prevTone = renderer.toneMapping
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false

    // ---- 1. HDR 场景 ----
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setRenderTarget(this.sceneRT)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    renderer.render(scene, camera)

    // 第一人称枪模画进同一张 HDR 图：这样它和场景共享曝光、泛光和调色，
    // 不会出现"枪亮一档"的贴纸感
    if (overlay) {
      renderer.clearDepth()
      renderer.render(overlay.scene, overlay.camera)
    }

    const tanHalfY = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
    const tanHalf = new THREE.Vector2(tanHalfY * camera.aspect, tanHalfY)

    // ---- 2. 太阳屏幕坐标（同时用于耀斑和光束） ----
    this.tmpV.copy(state.sunDir).multiplyScalar(100).add(camera.position).project(camera)
    this.sunUv.set(this.tmpV.x * 0.5 + 0.5, this.tmpV.y * 0.5 + 0.5)
    const behind = this.tmpV.z > 1
    const sunOn = behind || state.sunOn <= 0.001 ? 0 : 1

    // ---- 3. SSAO ----
    if (this.settings.ao) {
      const u = this.aoPass.material.uniforms
      u.tDepth!.value = this.sceneRT.depthTexture
      u.uTexel!.value.set(1 / this.aoRT.width, 1 / this.aoRT.height)
      u.uTanHalf!.value.copy(tanHalf)
      u.uAspect!.value = camera.aspect
      u.uNear!.value = camera.near
      u.uFar!.value = camera.far
      this.aoPass.render(renderer, this.aoRT)
    }

    // ---- 4. 体积光束（半分辨率） ----
    if (this.settings.shafts) {
      const u = this.shaftPass.material.uniforms
      u.tScene!.value = this.sceneRT.texture
      u.tDepth!.value = this.sceneRT.depthTexture
      u.uSunUv!.value.copy(this.sunUv)
      u.uSunOn!.value = sunOn
      u.uAspect!.value = camera.aspect
      u.uNight!.value = state.night
      this.shaftPass.render(renderer, this.shaftRT)
    }

    // ---- 5. 泛光链 ----
    const pre = this.prePass.material.uniforms
    pre.tSrc!.value = this.sceneRT.texture
    pre.uThreshold!.value = 1.05
    this.prePass.render(renderer, this.bloomMips[0]!)

    for (let i = 1; i < this.bloomMips.length; i++) {
      const u = this.downPass.material.uniforms
      u.tSrc!.value = this.bloomMips[i - 1]!.texture
      u.uTexel!.value.set(1 / this.bloomMips[i - 1]!.width, 1 / this.bloomMips[i - 1]!.height)
      u.uFirst!.value = i === 1 ? 1 : 0
      this.downPass.render(renderer, this.bloomMips[i]!)
    }
    for (let i = this.bloomMips.length - 1; i > 0; i--) {
      const u = this.upPass.material.uniforms
      u.tLow!.value = this.bloomMips[i]!.texture
      u.uTexel!.value.set(1 / this.bloomMips[i]!.width, 1 / this.bloomMips[i]!.height)
      u.uScale!.value = 1.0
      this.upPass.render(renderer, this.bloomMips[i - 1]!, false)
    }

    // ---- 6. 合成 ----
    const cu = this.compPass.material.uniforms
    cu.tScene!.value = this.sceneRT.texture
    cu.tBloom!.value = this.bloomMips[0]!.texture
    cu.tAO!.value = this.aoRT.texture
    cu.tShaft!.value = this.shaftRT.texture
    cu.tDepth!.value = this.sceneRT.depthTexture
    cu.uRes!.value.set(this.width, this.height)
    cu.uHalfRes!.value.set(this.aoRT.width, this.aoRT.height)
    cu.uSunUv!.value.copy(this.sunUv)
    cu.uSunOn!.value = sunOn
    cu.uSunCol!.value.copy(state.sunColor)
    cu.uSunDir!.value.copy(state.sunDir).normalize()
    cu.uFogColor!.value.copy(state.fogColor)
    cu.uFogSun!.value.copy(state.fogSun)
    cu.uFogDensity!.value = state.fogDensity
    cu.uFogHeight!.value = state.fogHeight
    cu.uExposure!.value = state.exposure
    cu.uBloom!.value = state.bloom
    cu.uShafts!.value = state.shafts
    cu.uVignette!.value = state.vignette
    cu.uGrain!.value = state.grain
    cu.uSaturation!.value = state.saturation
    cu.uFade!.value = state.fade
    cu.uNight!.value = state.night
    cu.uTime!.value = state.time
    cu.uAspect!.value = camera.aspect
    cu.uCamPos!.value.copy(camera.position)
    cu.uNear!.value = camera.near
    cu.uFar!.value = camera.far
    this.invViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert()
    cu.uInvViewProj!.value.copy(this.invViewProj)
    this.compPass.render(renderer, this.compRT)

    // ---- 7. FXAA → 画布 ----
    const fu = this.fxaaPass.material.uniforms
    fu.tSrc!.value = this.compRT.texture
    fu.uTexel!.value.set(1 / this.width, 1 / this.height)
    this.fxaaPass.render(renderer, null)

    renderer.toneMapping = prevTone
    renderer.autoClear = prevAutoClear
  }

  /** 调试用：把 HDR 场景原样输出到画布（不做后期） */
  debugScene() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tSrc; void main(){ vec3 c = texture2D(tSrc, vUv).rgb; gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0/2.2)), 1.0); }`,
      uniforms: { tSrc: { value: this.sceneRT.texture } },
      depthTest: false,
      depthWrite: false,
    })
    const scene = new THREE.Scene()
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    mesh.frustumCulled = false
    scene.add(mesh)
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const prev = this.renderer.autoClear
    this.renderer.autoClear = false
    this.renderer.setRenderTarget(null)
    this.renderer.render(scene, cam)
    this.renderer.autoClear = prev
    mat.dispose()
    mesh.geometry.dispose()
  }

  dispose() {
    this.disposeTargets()
    this.aoPass.dispose()
    this.shaftPass.dispose()
    this.prePass.dispose()
    this.downPass.dispose()
    this.upPass.dispose()
    this.compPass.dispose()
    this.fxaaPass.dispose()
  }
}
