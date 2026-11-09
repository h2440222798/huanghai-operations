import { shallowRef } from 'vue'

/** 注册表版本号：UI 依赖它重新计算可选武器 / 主题列表 */
export const modRegistryVersion = shallowRef(0)

export function bumpModRegistry(): void {
  modRegistryVersion.value += 1
}
