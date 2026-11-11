/**
 * 电影级渲染管线用到的 GLSL 片段。
 *
 * 这里的噪声是「程序化 value noise」——不依赖贴图，任何材质 / 天空 / 后期
 * pass 都能直接 include，省掉一张 256² 的随机图，也避免各向异性采样带来的
 * 条纹。整套渲染的目标是参考项目那套「黄昏逆光 + 体积雾 + 胶片调色」的观感。
 */

/** 哈希 / 噪声 / fbm —— 天空、泛光抖动、颗粒都用它 */
export const GLSL_NOISE = /* glsl */ `
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// interleaved gradient noise：比白噪声更像胶片颗粒，且分布均匀
float ign(vec2 p){
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 FBM_ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm3(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = FBM_ROT * p + 17.3; a *= 0.5; }
  return s / 0.875;
}
float fbm5(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = FBM_ROT * p + 17.3; a *= 0.5; }
  return s / 0.96875;
}
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`

/**
 * 地平线方向色：朝太阳一侧被染暖，背光一侧偏冷。
 * 注意这里不声明 uniform —— 由各 shader 自己声明，避免重复定义。
 */
export const GLSL_SKY_COMMON = /* glsl */ `
float skyToSun(vec3 d){
  vec2 a = normalize(d.xz + vec2(1e-5));
  vec2 b = normalize(uSunDir.xz + vec2(1e-5));
  return clamp(dot(a, b) * 0.5 + 0.5, 0.0, 1.0);
}
vec3 horizonColor(vec3 d){
  float ts = skyToSun(d);
  vec3 c = mix(uHorAway, uHorAway * 1.25 + vec3(0.05, 0.03, 0.02), smoothstep(0.2, 0.75, ts));
  c = mix(c, uHor * vec3(1.9, 1.55, 1.2), pow(ts, 6.0));
  c = mix(c, vec3(1.0, 0.60, 0.24) * 3.4, pow(ts, 34.0));
  return c;
}
`

/**
 * AgX（Filament / Blender 拟合，与 three.js 一致）+ ACES Hill。
 * 参考项目用两者按比例混合：ACES 给橙色高光"烧"的感觉，AgX 让高光滚到白。
 */
export const GLSL_TONE = /* glsl */ `
const mat3 SL_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 SL_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
vec3 slAgxContrast(vec3 x){
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 slAgx(vec3 color){
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = inset * (SL_SRGB_TO_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = slAgxContrast(color);
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, vec3(0.0)), vec3(1.06));
  color = l + (color - l) * 1.14;
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(SL_REC2020_TO_SRGB * color, 0.0, 1.0);
}
vec3 slRRTODT(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 slAces(vec3 c){
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * slRRTODT(inM * (c * 1.3)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`

/** 透视深度 ↔ 视空间距离互转（three 的 depthTexture 是非线性的） */
export const GLSL_DEPTH = /* glsl */ `
uniform float uNear, uFar;
float viewZ(float d){
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
`

/** 顶点着色器：全屏三角形 */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
