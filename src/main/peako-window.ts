import { BrowserWindow, Menu, ipcMain, screen, shell, type IpcMainEvent, type Rectangle } from 'electron'
import {
  PEAKO_CHANNELS,
  PEAKO_DEFAULT_NAME,
  PEAKO_SETTING_KEYS,
  isPeakoCommand,
  normalizePeakoName,
  type PeakoCommand,
  type PeakoLayout,
  type PeakoMainCommand,
  type PeakoState
} from '../shared/peako'

export const PEAKO_MASCOT_SIZE = { width: 132, height: 148 }
export const PEAKO_PANEL_SIZE = { width: 360, height: 500 }
const EDGE_MARGIN = 24

interface Point {
  x: number
  y: number
}

/** The window's bounds for a mascot at `mascot` (its top-left on screen). */
export function peakoWindowBounds(mascot: Point, layout: PeakoLayout): Rectangle {
  if (!layout.expanded) {
    return { x: mascot.x, y: mascot.y, ...PEAKO_MASCOT_SIZE }
  }
  const width = PEAKO_MASCOT_SIZE.width + PEAKO_PANEL_SIZE.width
  const height = Math.max(PEAKO_MASCOT_SIZE.height, PEAKO_PANEL_SIZE.height)
  return {
    x: layout.panelSide === 'right' ? mascot.x : mascot.x - PEAKO_PANEL_SIZE.width,
    y: layout.mascotAtTop ? mascot.y : mascot.y + PEAKO_MASCOT_SIZE.height - height,
    width,
    height
  }
}

/** Where the mascot sits on screen for a window at `bounds`. */
export function peakoMascotOrigin(bounds: Rectangle, layout: PeakoLayout): Point {
  if (!layout.expanded) return { x: bounds.x, y: bounds.y }
  return {
    x: layout.panelSide === 'right' ? bounds.x : bounds.x + PEAKO_PANEL_SIZE.width,
    y: layout.mascotAtTop ? bounds.y : bounds.y + bounds.height - PEAKO_MASCOT_SIZE.height
  }
}

/** Opens the panel toward the side of the screen with room for it. */
export function choosePeakoLayout(mascot: Point, workArea: Rectangle): PeakoLayout {
  const roomRight = workArea.x + workArea.width - (mascot.x + PEAKO_MASCOT_SIZE.width)
  const roomLeft = mascot.x - workArea.x
  const roomAbove = mascot.y + PEAKO_MASCOT_SIZE.height - workArea.y
  return {
    expanded: true,
    panelSide: roomRight >= PEAKO_PANEL_SIZE.width || roomRight >= roomLeft ? 'right' : 'left',
    mascotAtTop: roomAbove < PEAKO_PANEL_SIZE.height
  }
}

/** Moves a rectangle the least distance needed to fit inside `area`. */
export function clampRect(rect: Rectangle, area: Rectangle): Rectangle {
  const x = Math.min(Math.max(rect.x, area.x), area.x + Math.max(0, area.width - rect.width))
  const y = Math.min(Math.max(rect.y, area.y), area.y + Math.max(0, area.height - rect.height))
  return { ...rect, x: Math.round(x), y: Math.round(y) }
}

export function defaultPeakoPosition(workArea: Rectangle): Point {
  return {
    x: workArea.x + workArea.width - PEAKO_MASCOT_SIZE.width - EDGE_MARGIN,
    y: workArea.y + workArea.height - PEAKO_MASCOT_SIZE.height - EDGE_MARGIN
  }
}

export function parsePeakoPosition(raw: string | undefined | null): Point | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Point>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number' && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: Math.round(parsed.x), y: Math.round(parsed.y) }
    }
  } catch {
    // A corrupt value falls back to the default corner.
  }
  return null
}

export interface PeakoWindowDeps {
  getSetting: (key: string) => string | undefined
  setSetting: (key: string, value: string) => void
  getMainWindow: () => BrowserWindow | null
  showMainWindow: () => void
  preloadPath: string
  loadPage: (window: BrowserWindow) => void
}

const COLLAPSED: PeakoLayout = { expanded: false, panelSide: 'right', mascotAtTop: false }

/**
 * Owns Peako's desktop window and relays between it and the main window.
 *
 * The main window renderer owns the Mastermind session and voice; this class
 * forwards its published state to Peako and Peako's commands back to it.
 */
export class PeakoWindowManager {
  private window: BrowserWindow | null = null
  private layout: PeakoLayout = COLLAPSED
  private mascot: Point | null = null
  private lastState: PeakoState | null = null
  private ipcRegistered = false

  constructor(private readonly deps: PeakoWindowDeps) {}

  isEnabled(): boolean {
    // On by default: the setting only exists once someone hides Peako.
    return this.deps.getSetting(PEAKO_SETTING_KEYS.enabled) !== 'false'
  }

  /** Shows or hides Peako to match the saved setting. */
  sync(): void {
    if (this.isEnabled()) this.show()
    else this.destroy()
  }

  setEnabled(enabled: boolean): void {
    this.deps.setSetting(PEAKO_SETTING_KEYS.enabled, enabled ? 'true' : 'false')
    this.sync()
  }

  destroy(): void {
    const win = this.window
    this.window = null
    this.layout = COLLAPSED
    if (win && !win.isDestroyed()) win.destroy()
  }

  registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    ipcMain.on(PEAKO_CHANNELS.publishState, (event, state: PeakoState) => {
      if (!this.isFromMainWindow(event)) return
      this.lastState = state
      this.sendToPeako(PEAKO_CHANNELS.state, state)
    })

    ipcMain.handle(PEAKO_CHANNELS.setEnabled, (_event, enabled: unknown) => {
      this.setEnabled(enabled === true)
      return this.isEnabled()
    })
    ipcMain.handle(PEAKO_CHANNELS.getEnabled, () => this.isEnabled())

    ipcMain.on(PEAKO_CHANNELS.ready, (event) => {
      if (!this.isFromPeako(event)) return
      this.sendToPeako(PEAKO_CHANNELS.layout, this.layout)
      if (this.lastState) this.sendToPeako(PEAKO_CHANNELS.state, this.lastState)
      // Ask the main window for a fresh copy in case it changed while loading.
      this.sendToMain({ type: 'requestState' })
    })

    ipcMain.on(PEAKO_CHANNELS.command, (event, command: unknown) => {
      if (!this.isFromPeako(event) || !isPeakoCommand(command)) return
      this.handleCommand(command)
    })

    ipcMain.handle(PEAKO_CHANNELS.setExpanded, (event, expanded: unknown) => {
      if (!this.isFromPeako(event)) return this.layout
      this.setExpanded(expanded === true)
      return this.layout
    })

    ipcMain.on(PEAKO_CHANNELS.dragMove, (event, x: unknown, y: unknown) => {
      if (!this.isFromPeako(event) || typeof x !== 'number' || typeof y !== 'number') return
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      const win = this.window!
      const { width, height } = win.getBounds()
      // setBounds with a fixed size: setPosition alone lets a transparent
      // window creep larger under fractional display scaling on Windows.
      win.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
    })

    ipcMain.on(PEAKO_CHANNELS.dragEnd, (event) => {
      if (!this.isFromPeako(event)) return
      this.settleIntoDisplay()
    })

    ipcMain.on(PEAKO_CHANNELS.contextMenu, (event) => {
      if (!this.isFromPeako(event)) return
      this.popupContextMenu()
    })

    screen.on('display-removed', () => this.settleIntoDisplay())
    screen.on('display-metrics-changed', () => this.settleIntoDisplay())
  }

  private show(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (!this.window.isVisible()) this.window.showInactive()
      return
    }

    const workArea = screen.getPrimaryDisplay().workArea
    const saved = parsePeakoPosition(this.deps.getSetting(PEAKO_SETTING_KEYS.position))
    this.layout = COLLAPSED
    this.mascot = saved ?? defaultPeakoPosition(workArea)
    const bounds = this.fitToDisplay(peakoWindowBounds(this.mascot, this.layout))
    this.mascot = peakoMascotOrigin(bounds, this.layout)

    const isMac = process.platform === 'darwin'
    const isWindows = process.platform === 'win32'
    const win = new BrowserWindow({
      ...bounds,
      title: this.currentName(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // A tool window on Windows stays out of Alt+Tab as well as the taskbar.
      ...(isWindows ? { type: 'toolbar' as const } : {}),
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    this.window = win

    // 'floating' keeps Peako above normal windows on every platform. On macOS
    // it must also join every Space and float over full-screen apps; skipping
    // the process-type change keeps 20x's Dock icon.
    win.setAlwaysOnTop(true, 'floating')
    if (isMac) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    } else {
      win.setVisibleOnAllWorkspaces(true)
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => {
      // Never steal focus from what the user is doing.
      if (!win.isDestroyed()) win.showInactive()
    })
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })

    this.deps.loadPage(win)
  }

  private setExpanded(expanded: boolean): void {
    const win = this.window
    if (!win || win.isDestroyed() || this.layout.expanded === expanded) return
    const mascot = peakoMascotOrigin(win.getBounds(), this.layout)
    const workArea = screen.getDisplayMatching(win.getBounds()).workArea
    this.layout = expanded ? choosePeakoLayout(mascot, workArea) : COLLAPSED
    const bounds = clampRect(peakoWindowBounds(mascot, this.layout), workArea)
    this.mascot = peakoMascotOrigin(bounds, this.layout)
    win.setBounds(bounds)
    this.sendToPeako(PEAKO_CHANNELS.layout, this.layout)
    if (expanded) win.focus()
  }

  /** Pulls Peako back onto a screen after a drag or a display change, and saves where it is. */
  private settleIntoDisplay(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const bounds = this.fitToDisplay(win.getBounds())
    win.setBounds(bounds)
    this.mascot = peakoMascotOrigin(bounds, this.layout)
    this.deps.setSetting(PEAKO_SETTING_KEYS.position, JSON.stringify(this.mascot))
  }

  private fitToDisplay(bounds: Rectangle): Rectangle {
    return clampRect(bounds, screen.getDisplayMatching(bounds).workArea)
  }

  private handleCommand(command: PeakoCommand): void {
    switch (command.type) {
      case 'openApp':
        this.deps.showMainWindow()
        return
      case 'hide':
        this.setEnabled(false)
        this.sendToMain({ type: 'enabledChanged', enabled: false })
        return
      case 'openSettings':
        this.deps.showMainWindow()
        this.sendToMain(command)
        return
      case 'rename': {
        const name = normalizePeakoName(command.name)
        this.deps.setSetting(PEAKO_SETTING_KEYS.name, name)
        this.window?.setTitle(name)
        this.sendToMain({ type: 'rename', name })
        return
      }
      default:
        this.sendToMain(command)
    }
  }

  private popupContextMenu(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const name = this.currentName()
    const voiceAvailable = this.lastState?.voice.available === true
    Menu.buildFromTemplate([
      { label: this.layout.expanded ? `Close chat` : `Chat with ${name}`, click: () => this.setExpanded(!this.layout.expanded) },
      {
        label: this.lastState?.voice.listening ? 'Stop listening' : `Talk to ${name}`,
        enabled: voiceAvailable,
        click: () => this.sendToMain({ type: 'voice' })
      },
      { label: 'Open 20x', click: () => this.deps.showMainWindow() },
      { type: 'separator' },
      { label: `Rename ${name}…`, click: () => {
        this.setExpanded(true)
        this.sendToPeako(PEAKO_CHANNELS.startRename, null)
      } },
      { label: `${name} settings…`, click: () => this.handleCommand({ type: 'openSettings' }) },
      { label: `Hide ${name}`, click: () => this.handleCommand({ type: 'hide' }) }
    ]).popup({ window: win })
  }

  private currentName(): string {
    return normalizePeakoName(this.deps.getSetting(PEAKO_SETTING_KEYS.name) ?? PEAKO_DEFAULT_NAME)
  }

  private isFromPeako(event: IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    return this.window != null && !this.window.isDestroyed() && event.sender === this.window.webContents
  }

  private isFromMainWindow(event: IpcMainEvent): boolean {
    const main = this.deps.getMainWindow()
    return main != null && !main.isDestroyed() && event.sender === main.webContents
  }

  private sendToPeako(channel: string, payload: unknown): void {
    const win = this.window
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  private sendToMain(command: PeakoMainCommand): void {
    const main = this.deps.getMainWindow()
    if (main && !main.isDestroyed()) main.webContents.send(PEAKO_CHANNELS.mainCommand, command)
  }
}
