import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { WindowAuthManager } from '../../../services/airi/auth'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { GodotStageManager } from '../../../services/airi/godot-stage'
import type { LocalVoiceServiceManager } from '../../../services/airi/local-voice-services'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { LocalScreenConsentRegistry } from '../../../services/airi/perception/local-screen-consent-registry'
import type { LocalTransformersScreenManager } from '../../../services/airi/perception/local-transformers-screen'
import type { QwenCloudControlManager } from '../../../services/airi/perception/qwen-cloud-control-manager'
import type { QwenCloudGrantRegistry } from '../../../services/airi/perception/qwen-cloud-grant-registry'
import type { QwenCloudMediaGatewayManager } from '../../../services/airi/perception/qwen-cloud-media-gateway-manager'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { GlobalShortcutService } from '../../../services/electron/global-shortcut'
import type { DevtoolsWindowManager } from '../../devtools'
import type { SpotlightWindowManager } from '../../spotlight'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { electronStartLocalVoiceService, electronStopLocalVoiceService, isLocalVoiceServiceId } from '@proj-airi/stage-ui/domains/localVoiceServices'
import { ipcMain } from 'electron'

import {
  electronOpenDevtoolsWindow,
  electronOpenSettingsDevtools,
  electronSpotlightShortcutGet,
  electronSpotlightShortcutSet,
} from '../../../../shared/eventa'
import { createAuthService } from '../../../services/airi/auth'
import { createGodotStageService } from '../../../services/airi/godot-stage'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createLocalScreenCaptureExclusionService } from '../../../services/airi/perception/local-screen-capture-exclusion-service'
import { createLocalScreenConsentService } from '../../../services/airi/perception/local-screen-consent-service'
import { createLocalScreenGateway } from '../../../services/airi/perception/local-screen-gateway'
import { createQwenCloudControlService } from '../../../services/airi/perception/qwen-cloud-control-service'
import { createQwenCloudGrantService } from '../../../services/airi/perception/qwen-cloud-grant-service'
import { createQwenCloudMediaGatewayService } from '../../../services/airi/perception/qwen-cloud-media-gateway-service'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService, createCharacterSourceFileService, createCompanionPresetFileService } from '../../../services/electron'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupSettingsWindowInvokes(params: {
  settingsWindow: BrowserWindow
  widgetsManager: WidgetsWindowManager
  autoUpdater: AutoUpdater
  devtoolsWindow: DevtoolsWindowManager
  serverChannel: ServerChannel
  godotStageManager: GodotStageManager
  localVoiceServiceManager: LocalVoiceServiceManager
  mcpStdioManager: McpStdioManager
  i18n: I18n
  windowAuthManager: WindowAuthManager
  globalShortcut: GlobalShortcutService
  spotlightWindow: SpotlightWindowManager
  localScreenConsentRegistry: LocalScreenConsentRegistry
  localTransformersScreenManager: LocalTransformersScreenManager
  qwenCloudControlManager: QwenCloudControlManager
  qwenCloudGrantRegistry: QwenCloudGrantRegistry
  qwenCloudMediaGatewayManager: QwenCloudMediaGatewayManager
}) {
  // TODO: once we refactored eventa to support window-namespaced contexts,
  // we can remove the setMaxListeners call below since eventa will be able to dispatch and
  // manage events within eventa's context system.
  ipcMain.setMaxListeners(0)

  const { context, dispose } = createContext(ipcMain, params.settingsWindow)
  // Every perception service below registers on process-global `ipcMain` listeners, so each
  // handler has to verify the caller itself; see `windows/shared/windowScopedInvoke.ts`.
  const callerWebContentsId = params.settingsWindow.webContents.id
  const qwenCloudOwnerId = `renderer:${callerWebContentsId}`
  params.settingsWindow.once('closed', () => dispose('settings-window-closed'))

  await setupBaseWindowElectronInvokes({ context, window: params.settingsWindow, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.settingsWindow })
  createAutoUpdaterService({ context, window: params.settingsWindow, service: params.autoUpdater })
  createCompanionPresetFileService({ context, window: params.settingsWindow })
  createCharacterSourceFileService({ context, window: params.settingsWindow })
  createMcpServersService({ context, manager: params.mcpStdioManager })
  createGodotStageService({ context, manager: params.godotStageManager, window: params.settingsWindow })
  defineInvokeHandler(context, electronStartLocalVoiceService, (payload) => {
    if (!isLocalVoiceServiceId(payload?.serviceId))
      throw new TypeError('Invalid local voice service id')
    return params.localVoiceServiceManager.start(payload.serviceId)
  })
  defineInvokeHandler(context, electronStopLocalVoiceService, (payload) => {
    if (!isLocalVoiceServiceId(payload?.serviceId))
      throw new TypeError('Invalid local voice service id')
    return params.localVoiceServiceManager.stop(payload.serviceId)
  })
  createAuthService({ context, window: params.settingsWindow, windowAuthManager: params.windowAuthManager })

  // The settings window hosts the full perception control panel, so it needs the same local
  // screen trio as the main window. Without them a capture started from settings would open a
  // real MediaStream while its consent/exclusion/gateway invokes were answered by another
  // window's handlers, leaving the stream running, unregistered and never excluded.
  // The consent registry and screen manager are the same injected singletons the main window
  // uses, so `activeSessionId` mutual exclusion stays authoritative across windows.
  const cleanupLocalScreenConsent = createLocalScreenConsentService({
    context,
    registry: params.localScreenConsentRegistry,
    callerWebContentsId,
  })
  const cleanupLocalScreenCaptureExclusion = createLocalScreenCaptureExclusionService({
    context,
    registry: params.localScreenConsentRegistry,
    // Protect the settings window itself: it is the surface in front of the user while they
    // drive the capture, so it must stay out of the frames this registration feeds.
    window: params.settingsWindow,
    callerWebContentsId,
  })
  const cleanupLocalScreenGateway = createLocalScreenGateway({
    context,
    manager: params.localTransformersScreenManager,
    consent: params.localScreenConsentRegistry,
    callerWebContentsId,
  })
  const cleanupQwenCloudControl = createQwenCloudControlService({
    context,
    manager: params.qwenCloudControlManager,
    mediaGateway: params.qwenCloudMediaGatewayManager,
    callerWebContentsId,
  })
  const cleanupQwenCloudGrant = createQwenCloudGrantService({
    context,
    registry: params.qwenCloudGrantRegistry,
    ownerId: qwenCloudOwnerId,
    onRevoke: grantId => params.qwenCloudMediaGatewayManager.cancelByGrant(grantId),
    callerWebContentsId,
  })
  const cleanupQwenCloudMedia = createQwenCloudMediaGatewayService({
    context,
    manager: params.qwenCloudMediaGatewayManager,
    callerWebContentsId,
  })
  params.settingsWindow.once('closed', () => {
    params.qwenCloudGrantRegistry.clearOwner(qwenCloudOwnerId)
      .forEach(grantId => params.qwenCloudMediaGatewayManager.cancelByGrant(grantId))
    cleanupQwenCloudMedia()
    cleanupQwenCloudGrant()
    cleanupQwenCloudControl()
    cleanupLocalScreenGateway()
    cleanupLocalScreenCaptureExclusion()
    // Releases the local screen grants this window registered, and with them the
    // consent registry's session lock. Deliberately not `clearAll()` like the
    // main window's teardown: that one runs when the app itself goes away, while
    // closing settings must leave the main window's live consent untouched.
    cleanupLocalScreenConsent()
  })

  // Register the global shortcut service for the settings window.
  params.globalShortcut.registerWindow({ context, window: params.settingsWindow })

  defineInvokeHandler(context, electronSpotlightShortcutGet, () => params.spotlightWindow.getShortcutAccelerator())
  defineInvokeHandler(context, electronSpotlightShortcutSet, (payload) => {
    if (payload?.accelerator === undefined)
      throw new TypeError('electronSpotlightShortcutSet called with invalid payload')

    return params.spotlightWindow.updateShortcutAccelerator(payload.accelerator)
  })

  defineInvokeHandler(context, electronOpenSettingsDevtools, async () => params.settingsWindow.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenDevtoolsWindow, async (payload) => {
    await params.devtoolsWindow.openWindow(payload)
  })

  return context
}
