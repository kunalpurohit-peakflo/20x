import { useEffect, useRef } from 'react'
import { useAgentStore, SessionStatus } from '@/stores/agent-store'
import { useMastermindStore } from '@/stores/mastermind-store'
import { useTaskStore } from '@/stores/task-store'
import { useUIStore } from '@/stores/ui-store'
import { selectVoiceReady, useVoiceStore } from '@/stores/voice-store'
import { agentSessionApi, settingsApi } from '@/lib/ipc-client'
import {
  PEAKO_PARTY_MS,
  PEAKO_SESSION_ID,
  agentModelLabel,
  countSessions,
  derivePeakoMood,
  toPeakoMessages
} from '@/lib/peako-state'
import { PEAKO_SETTING_KEYS, normalizePeakoName, type PeakoMainCommand, type PeakoState } from '@shared/peako'
import { SettingsTab, TaskStatus } from '@/types'

const PUBLISH_DELAY_MS = 150
const BUBBLE_MS = 8000
/** Re-checks the clock-driven moods (sleep, end of a celebration). */
const TICK_MS = 30_000

export const PEAKO_SETTINGS_CHANGED_EVENT = 'peako-settings-changed'

interface PeakoBridgeProps {
  /** Starts or stops a voice conversation with Mastermind without opening the drawer. */
  onToggleVoice: () => void
}

/**
 * Feeds Peako's desktop window from this window's stores and carries out the
 * commands it sends back. Renders nothing.
 *
 * It listens to the stores directly rather than through React, and publishes
 * at most every 150 ms and only when something changed, so a busy transcript
 * does not re-render the app or flood IPC.
 */
export function PeakoBridge({ onToggleVoice }: PeakoBridgeProps) {
  const toggleVoiceRef = useRef(onToggleVoice)
  toggleVoiceRef.current = onToggleVoice

  useEffect(() => {
    const api = window.electronAPI?.peako
    if (!api) return

    let enabled = true
    let name = normalizePeakoName(null)
    let lastPublished = ''
    let timer: number | null = null
    let lastActivityAt = Date.now()
    let activitySignature = ''
    let celebrateUntil = 0
    let bubble: { text: string; until: number } | null = null
    let knownCompleted: Set<string> | null = null
    let knownWaiting = new Set<string>()

    const say = (text: string) => {
      bubble = { text, until: Date.now() + BUBBLE_MS }
      lastActivityAt = Date.now()
      window.setTimeout(schedule, BUBBLE_MS + 50)
    }

    const taskTitle = (taskId: string) =>
      useTaskStore.getState().tasks.find((task) => task.id === taskId)?.title ?? 'A task'

    const buildState = (): PeakoState => {
      const now = Date.now()
      const sessions = useAgentStore.getState().sessions
      const mastermind = sessions.get(PEAKO_SESSION_ID)
      const voice = useVoiceStore.getState()
      const { agents, selectedAgentId } = useMastermindStore.getState()
      const counts = countSessions(sessions.values())

      const approval = mastermind?.pendingApproval
        ? { action: mastermind.pendingApproval.action, description: mastermind.pendingApproval.description }
        : null
      const thinking = Boolean(mastermind?.pendingSend) || mastermind?.status === SessionStatus.WORKING
      const listening = Boolean(voice.turnId)

      const signature = `${counts.working}/${counts.waiting}/${counts.failed}/${mastermind?.messages.length ?? 0}/${thinking}/${listening}/${voice.speaking}`
      if (signature !== activitySignature) {
        activitySignature = signature
        lastActivityAt = now
      }
      if (bubble && bubble.until <= now) bubble = null

      return {
        name,
        mood: derivePeakoMood({
          listening,
          speaking: voice.speaking,
          thinking,
          waiting: counts.waiting + (approval ? 1 : 0),
          working: counts.working,
          failed: counts.failed,
          celebrating: celebrateUntil > now,
          idleForMs: now - lastActivityAt
        }),
        agents: agents.map((agent) => ({ id: agent.id, name: agent.name, model: agentModelLabel(agent.config) })),
        agentId: selectedAgentId,
        agentLocked: (mastermind?.messages.length ?? 0) > 0,
        status: approval ? 'waiting_approval' : ((mastermind?.status as PeakoState['status']) ?? 'idle'),
        messages: toPeakoMessages(mastermind?.messages ?? []),
        approval,
        voice: {
          available: selectVoiceReady(voice),
          listening,
          speaking: voice.speaking,
          partial: listening ? voice.partial : ''
        },
        counts,
        bubble: bubble?.text ?? null
      }
    }

    const publish = () => {
      timer = null
      if (!enabled) return
      const state = buildState()
      const serialized = JSON.stringify(state)
      if (serialized === lastPublished) return
      lastPublished = serialized
      api.publishState(state)
    }

    const schedule = () => {
      if (!enabled || timer !== null) return
      timer = window.setTimeout(publish, PUBLISH_DELAY_MS)
    }

    const watchTasks = () => {
      const tasks = useTaskStore.getState().tasks
      const completed = new Set(tasks.filter((task) => task.status === TaskStatus.Completed).map((task) => task.id))
      // The first load is history, not news.
      if (knownCompleted && tasks.length > 0) {
        const fresh = tasks.find((task) => completed.has(task.id) && !knownCompleted!.has(task.id))
        if (fresh) {
          celebrateUntil = Date.now() + PEAKO_PARTY_MS
          say(`Done: ${fresh.title}`)
          window.setTimeout(schedule, PEAKO_PARTY_MS + 50)
        }
      }
      if (tasks.length > 0) knownCompleted = completed
      schedule()
    }

    const watchSessions = () => {
      const waiting = new Set<string>()
      for (const session of useAgentStore.getState().sessions.values()) {
        if (session.taskId === PEAKO_SESSION_ID) continue
        if (session.pendingApproval || session.status === SessionStatus.WAITING_APPROVAL) waiting.add(session.taskId)
      }
      const fresh = [...waiting].find((taskId) => !knownWaiting.has(taskId))
      if (fresh) say(`${taskTitle(fresh)} needs your OK`)
      knownWaiting = waiting
      schedule()
    }

    const loadName = () =>
      settingsApi
        .get(PEAKO_SETTING_KEYS.name)
        .then((value) => {
          name = normalizePeakoName(value)
          schedule()
        })
        .catch(() => {})

    const handleCommand = (command: PeakoMainCommand) => {
      const mastermind = useAgentStore.getState().sessions.get(PEAKO_SESSION_ID)
      switch (command.type) {
        case 'requestState':
          lastPublished = ''
          schedule()
          return
        case 'enabledChanged':
          enabled = command.enabled
          window.dispatchEvent(new CustomEvent(PEAKO_SETTINGS_CHANGED_EVENT))
          if (enabled) schedule()
          return
        case 'send':
          lastActivityAt = Date.now()
          // The drawer's own send path: it starts the session if needed and
          // answers an open question instead of sending a new message.
          window.dispatchEvent(new CustomEvent('mastermind-prefill', { detail: { message: command.text } }))
          return
        case 'approve':
          if (mastermind?.sessionId) {
            void agentSessionApi.approve(mastermind.sessionId, command.approved).catch(console.error)
          }
          return
        case 'stop':
          if (mastermind?.sessionId) void agentSessionApi.abort(mastermind.sessionId).catch(console.error)
          return
        case 'voice':
          toggleVoiceRef.current()
          return
        case 'newChat':
          void useMastermindStore.getState().newConversation?.()
          return
        case 'setAgent':
          if (useMastermindStore.getState().agents.some((agent) => agent.id === command.agentId)) {
            void useMastermindStore.getState().changeAgent?.(command.agentId)
          }
          return
        case 'rename':
          name = normalizePeakoName(command.name)
          window.dispatchEvent(new CustomEvent(PEAKO_SETTINGS_CHANGED_EVENT))
          schedule()
          return
        case 'openSettings':
          useUIStore.getState().setSettingsTab(SettingsTab.GENERAL)
          useUIStore.getState().openSettings()
          return
        default:
          return
      }
    }

    const handleSettingsChanged = () => {
      void loadName()
      void api.getEnabled().then((value) => {
        enabled = value
        if (enabled) {
          lastPublished = ''
          schedule()
        }
      })
    }

    void api.getEnabled().then((value) => {
      enabled = value
      schedule()
    })
    void loadName()
    watchTasks()
    watchSessions()

    const unsubscribers = [
      useAgentStore.subscribe(watchSessions),
      useVoiceStore.subscribe(schedule),
      useMastermindStore.subscribe(schedule),
      useTaskStore.subscribe(watchTasks),
      api.onCommand(handleCommand)
    ]
    window.addEventListener(PEAKO_SETTINGS_CHANGED_EVENT, handleSettingsChanged)
    const tick = window.setInterval(schedule, TICK_MS)

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      window.removeEventListener(PEAKO_SETTINGS_CHANGED_EVENT, handleSettingsChanged)
      window.clearInterval(tick)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [])

  return null
}
