import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { WindowAuthManager } from '../../../services/airi/auth'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { GodotStageManager } from '../../../services/airi/godot-stage'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { LocalScreenConsentRegistry } from '../../../services/airi/perception/local-screen-consent-registry'
import type { LocalTransformersScreenManager } from '../../../services/airi/perception/local-transformers-screen'
import type { QwenCloudControlManager } from '../../../services/airi/perception/qwen-cloud-control-manager'
import type { QwenCloudGrantRegistry } from '../../../services/airi/perception/qwen-cloud-grant-registry'
import type { QwenCloudMediaGatewayManager } from '../../../services/airi/perception/qwen-cloud-media-gateway-manager'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { NoticeWindowManager } from '../../notice'
import type { OnboardingWindowManager } from '../../onboarding'
import type { SettingsWindowManager } from '../../settings'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronOpenChat, electronOpenMainDevtools, electronOpenSettings, noticeWindowEventa } from '../../../../shared/eventa'
import { createAuthService } from '../../../services/airi/auth'
import { createGodotStageService } from '../../../services/airi/godot-stage'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createOnboardingService } from '../../../services/airi/onboarding'
import { createLocalScreenCaptureExclusionService } from '../../../services/airi/perception/local-screen-capture-exclusion-service'
import { createLocalScreenConsentService } from '../../../services/airi/perception/local-screen-consent-service'
import { createLocalScreenGateway } from '../../../services/airi/perception/local-screen-gateway'
import { createQwenCloudControlService } from '../../../services/airi/perception/qwen-cloud-control-service'
import { createQwenCloudGrantService } from '../../../services/airi/perception/qwen-cloud-grant-service'
import { createQwenCloudMediaGatewayService } from '../../../services/airi/perception/qwen-cloud-media-gateway-service'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { toggleWindowShow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupMainWindowElectronInvokes(params: {
  window: BrowserWindow
  settingsWindow: SettingsWindowManager
  chatWindow: () => Promise<BrowserWindow>
  widgetsManager: WidgetsWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  serverChannel: ServerChannel
  godotStageManager: GodotStageManager
  mcpStdioManager: McpStdioManager
  i18n: I18n
  onboardingWindowManager: OnboardingWindowManager
  windowAuthManager: WindowAuthManager
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

  const { context } = createContext(ipcMain, params.window)
  // Every perception service below registers on process-global `ipcMain` listeners, so each
  // handler has to verify the caller itself; see `windows/shared/windowScopedInvoke.ts`.
  const callerWebContentsId = params.window.webContents.id
  const qwenCloudOwnerId = `renderer:${callerWebContentsId}`

  await setupBaseWindowElectronInvokes({ context, window: params.window, serverChannel: params.serverChannel, i18n: params.i18n })
  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createAutoUpdaterService({ context, window: params.window, service: params.autoUpdater })
  createMcpServersService({ context, manager: params.mcpStdioManager })
  createGodotStageService({ context, manager: params.godotStageManager, window: params.window })
  createOnboardingService({ context, onboardingWindowManager: params.onboardingWindowManager, mainWindow: params.window })
  createAuthService({ context, window: params.window, windowAuthManager: params.windowAuthManager })

  const cleanupLocalScreenConsent = createLocalScreenConsentService({
    context,
    registry: params.localScreenConsentRegistry,
    callerWebContentsId,
  })
  const cleanupLocalScreenCaptureExclusion = createLocalScreenCaptureExclusionService({
    context,
    registry: params.localScreenConsentRegistry,
    window: params.window,
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
  params.window.once('closed', () => {
    params.qwenCloudGrantRegistry.clearOwner(qwenCloudOwnerId)
      .forEach(grantId => params.qwenCloudMediaGatewayManager.cancelByGrant(grantId))
    cleanupQwenCloudMedia()
    cleanupQwenCloudGrant()
    cleanupQwenCloudControl()
    cleanupLocalScreenGateway()
    cleanupLocalScreenCaptureExclusion()
    cleanupLocalScreenConsent()
    params.localScreenConsentRegistry.clearAll()
    void params.localTransformersScreenManager.stopAll()
  })

  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenSettings, payload => params.settingsWindow.openWindow(payload?.route))
  defineInvokeHandler(context, electronOpenChat, async () => toggleWindowShow(await params.chatWindow()))
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))
}
