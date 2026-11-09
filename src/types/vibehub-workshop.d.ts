/**
 * VibeHub 创意工坊 Loader 的全局类型（v1）。
 * 仅描述本游戏实际用到的字段，全部按官方 loader 源码整理。
 */

export interface VibeHubWorkshopMod {
  id: string
  title?: string
  version?: string
  entryUrl: string
  baseUrl?: string
  styleUrls?: string[]
  entryType?: 'classic' | 'module'
  loadPhase?: 'before-start' | 'after-start'
  capabilities?: string[]
  dependencyIds?: string[]
}

export interface VibeHubWorkshopCapability {
  id: string
  name?: string
  description?: string
  multiplayer?: 'local' | 'blocked'
}

export interface VibeHubWorkshopError {
  id: string
  title?: string
  message?: string
}

export interface VibeHubWorkshopResult {
  mods: VibeHubWorkshopMod[]
  errors: VibeHubWorkshopError[]
}

export interface VibeHubWorkshopGlobal {
  ready: Promise<VibeHubWorkshopResult>
  beforeStart: Promise<VibeHubWorkshopResult>
  afterStart: Promise<VibeHubWorkshopResult>
  mods: VibeHubWorkshopMod[]
  errors: VibeHubWorkshopError[]
  currentMod: VibeHubWorkshopMod | null
  multiplayerPolicy: 'mods-disabled' | 'author-managed'
  capabilities: VibeHubWorkshopCapability[]
  getEnabledMods(): VibeHubWorkshopMod[]
  getCapability(id: string): VibeHubWorkshopCapability | null
  getMod(id: string): VibeHubWorkshopMod | null
  resolve(modId: string, path: string): string
  createWorker(modId: string, path: string, options?: WorkerOptions): Promise<Worker>
  markGameReady(): void
}

declare global {
  interface Window {
    VibeHubWorkshop?: VibeHubWorkshopGlobal
  }
}
