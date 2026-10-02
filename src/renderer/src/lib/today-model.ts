import { TaskStatus } from '@/types'

/** The fields the Today home reads from a task. */
export interface TodayTask {
  id: string
  title: string
  status: TaskStatus
  priority: string
  due_date: string | null
  agent_id: string | null
  snoozed_until: string | null
  parent_task_id: string | null
  updated_at: string
}

export interface TodaySession {
  taskId: string
  sessionId: string | null
  status: string
  pendingApproval: { action: string; description: string } | null
}

export type NeedsYouItem =
  | { kind: 'approval'; taskId: string; sessionId: string; title: string; action: string }
  | { kind: 'review'; taskId: string; title: string; overdue: boolean; agentId: string | null }
  | { kind: 'overdue'; taskId: string; title: string }

export interface TodayModel {
  needsYou: NeedsYouItem[]
  running: { taskId: string; title: string; status: 'working' | 'triaging'; agentId: string | null }[]
  upNext: { taskId: string; title: string; due: string | null; priority: string }[]
  /** Tasks finished on each day of the current week, Monday first. */
  week: number[]
  /** 0 = Monday … 6 = Sunday. */
  todayIndex: number
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const UP_NEXT_LIMIT = 6

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function isOverdue(due: string | null, now: Date): boolean {
  return due != null && startOfDay(new Date(due)) < startOfDay(now)
}

function isSnoozed(until: string | null, now: Date): boolean {
  return until != null && new Date(until) > now
}

/** Monday-first index of a date's weekday. */
function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7
}

/**
 * Sorts tasks and sessions into what the Today home shows: what needs the
 * user, what agents are doing, and what comes next. Subtasks and snoozed
 * tasks stay out of the lists.
 */
export function buildTodayModel(tasks: TodayTask[], sessions: TodaySession[], now = new Date()): TodayModel {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const visible = tasks.filter((task) => !task.parent_task_id && !isSnoozed(task.snoozed_until, now))
  const needsYou: NeedsYouItem[] = []
  const listed = new Set<string>()

  for (const session of sessions) {
    const task = byId.get(session.taskId)
    if (!task || !session.sessionId || !session.pendingApproval) continue
    needsYou.push({
      kind: 'approval',
      taskId: task.id,
      sessionId: session.sessionId,
      title: task.title,
      action: session.pendingApproval.action || session.pendingApproval.description
    })
    listed.add(task.id)
  }

  const reviews = visible
    .filter((task) => task.status === TaskStatus.ReadyForReview && !listed.has(task.id))
    .sort((a, b) => Number(isOverdue(b.due_date, now)) - Number(isOverdue(a.due_date, now)))
  for (const task of reviews) {
    needsYou.push({ kind: 'review', taskId: task.id, title: task.title, overdue: isOverdue(task.due_date, now), agentId: task.agent_id })
    listed.add(task.id)
  }

  for (const task of visible) {
    if (listed.has(task.id) || task.status !== TaskStatus.NotStarted || !isOverdue(task.due_date, now)) continue
    needsYou.push({ kind: 'overdue', taskId: task.id, title: task.title })
    listed.add(task.id)
  }

  const running = visible
    .filter((task) => task.status === TaskStatus.AgentWorking || task.status === TaskStatus.Triaging)
    .filter((task) => !listed.has(task.id))
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      status: task.status === TaskStatus.Triaging ? ('triaging' as const) : ('working' as const),
      agentId: task.agent_id
    }))

  const upNext = visible
    .filter((task) => task.status === TaskStatus.NotStarted && !listed.has(task.id))
    .sort((a, b) => {
      const rank = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
      if (rank !== 0) return rank
      const aDue = a.due_date ? new Date(a.due_date).getTime() : Infinity
      const bDue = b.due_date ? new Date(b.due_date).getTime() : Infinity
      return aDue - bDue
    })
    .slice(0, UP_NEXT_LIMIT)
    .map((task) => ({ taskId: task.id, title: task.title, due: task.due_date, priority: task.priority }))

  const todayIndex = weekdayIndex(now)
  const weekStart = startOfDay(now) - todayIndex * 86_400_000
  const week = [0, 0, 0, 0, 0, 0, 0]
  for (const task of tasks) {
    if (task.status !== TaskStatus.Completed) continue
    const day = startOfDay(new Date(task.updated_at))
    const index = Math.round((day - weekStart) / 86_400_000)
    if (index >= 0 && index <= todayIndex) week[index]++
  }

  return { needsYou, running, upNext, week, todayIndex }
}

/** "Two things need you." for the headline. */
export function needsYouHeadline(count: number): string {
  if (count === 0) return 'Nothing needs you right now.'
  const words = ['One thing needs', 'Two things need', 'Three things need', 'Four things need', 'Five things need']
  return `${words[count - 1] ?? `${count} things need`} you.`
}

export function greetingFor(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}
