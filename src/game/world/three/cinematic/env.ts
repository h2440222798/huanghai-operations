import * as THREE from 'three'

/**
 * 用真实的程序化天空烘一张 PMREM 环境贴图。
 *
 * 老实现是画一张渐变 canvas 再当等距柱状图用，既没有云也没有太阳的方向性，
 * 玻璃和湿地面反射出来都是死板的渐变色。这里直接把天空穹顶渲染进 cube RT，
 * 再交给 PMREMGenerator —— 云底、日轮、地平线暖光都会进到 IBL 里，
 * 金属和玻璃立刻有了"环境感"，也顺带省掉了一堆手绘云。
 */

interface SkyLike {
  dome: THREE.Mesh
  setEnvMode: (on: boolean) => void
}

export interface SkyEnvironment {
  update: (
    renderer: THREE.WebGLRenderer,
    sky: SkyLike,
    opts: { night: number; dusk: number; dt: number; force?: boolean },
  ) => THREE.Texture | null
  dispose: () => void
}

export function createSkyEnvironment(interval = 2.5): SkyEnvironment {
  const envScene = new THREE.Scene()
  let domeMesh: THREE.Mesh | null = null
  let cubeRT: THREE.WebGLCubeRenderTarget | null = null
  let cubeCam: THREE.CubeCamera | null = null
  let pmrem: THREE.PMREMGenerator | null = null
  let target: THREE.WebGLRenderTarget | null = null
  let texture: THREE.Texture | null = null
  let cooldown = 0
  let lastNight = -1
  let lastDusk = -1

  return {
    update(renderer, sky, opts) {
      cooldown -= opts.dt
      const changed =
        lastNight < 0 || Math.abs(opts.night - lastNight) > 0.07 || Math.abs(opts.dusk - lastDusk) > 0.07
      if (!opts.force && !changed && cooldown > 0) return texture

      cooldown = interval
      lastNight = opts.night
      lastDusk = opts.dusk

      if (!domeMesh) {
        domeMesh = new THREE.Mesh(
          new THREE.SphereGeometry(60, 32, 16),
          sky.dome.material as THREE.Material,
        )
        domeMesh.frustumCulled = false
        envScene.add(domeMesh)
      }
      if (!cubeRT) {
        cubeRT = new THREE.WebGLCubeRenderTarget(256, {
          type: THREE.HalfFloatType,
          generateMipmaps: false,
          colorSpace: THREE.LinearSRGBColorSpace,
        })
        cubeCam = new THREE.CubeCamera(0.5, 400, cubeRT)
        cubeCam.position.set(0, 0, 0)
      }
      if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer)

      const prevTone = renderer.toneMapping
      renderer.toneMapping = THREE.NoToneMapping
      sky.setEnvMode(true)
      try {
        cubeCam!.update(renderer, envScene)
      } finally {
        sky.setEnvMode(false)
        renderer.toneMapping = prevTone
      }

      const next = pmrem!.fromCubemap(cubeRT!.texture)
      target?.dispose()
      target = next
      texture = next.texture
      return texture
    },
    dispose() {
      target?.dispose()
      target = null
      texture = null
      pmrem?.dispose()
      pmrem = null
      cubeRT?.dispose()
      cubeRT = null
      domeMesh?.geometry.dispose()
      domeMesh = null
    },
  }
}
