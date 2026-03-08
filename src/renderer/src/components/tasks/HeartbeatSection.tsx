import { useState, useEffect, useCallback, useRef } from 'react'
import { HeartPulse, Play, Pause, Clock, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronRight, Pencil, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type { WorkfloTask } from '@/types'
import type { HeartbeatStatusResult, HeartbeatAlertEvent } from '@/types/electron'
import { HeartbeatStatus } from '@/types'
import { formatRelativeDate } from '@/lib/utils'

interface HeartbeatLog {
  id: string
  task_id: string
  status: string
  summary: string | null
  session_id: string | null
  created_at: string
}

interface HeartbeatSectionProps {
  task: WorkfloTask
  onTaskUpdated?: () => void
}

const INTERVAL_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
]

export function HeartbeatSection({ task, onTaskUpdated }: HeartbeatSectionProps) {
  const [status, setStatus] = useState<HeartbeatStatusResult | null>(null)
  const [logs, setLogs] = useState<HeartbeatLog[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [logsExpanded, setLogsExpanded] = useState(false)
  const [heartbeatContent, setHeartbeatContent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const result = await window.electronAPI.heartbeat.getStatus(task.id)
      setStatus(result)
    } catch {
      // Heartbeat API may not be available
    }
  }, [task.id])

  const fetchLogs = useCallback(async () => {
    try {
      const result = await window.electronAPI.heartbeat.getLogs(task.id, 10) as HeartbeatLog[]
      setLogs(result)
    } catch {
      // Ignore
    }
  }, [task.id])

  const fetchContent = useCallback(async () => {
    try {
      const content = await window.electronAPI.heartbeat.readFile(task.id)
      setHeartbeatContent(content)
    } catch {
      // Ignore
    }
  }, [task.id])

  // Initial load
  useEffect(() => {
    fetchStatus()
    fetchLogs()
    fetchContent()
  }, [fetchStatus, fetchLogs, fetchContent])

  // Listen for heartbeat alerts
  useEffect(() => {
    const unsubAlert = window.electronAPI.onHeartbeatAlert((event: unknown) => {
      const alert = event as HeartbeatAlertEvent
      if (alert.taskId === task.id) {
        fetchStatus()
        fetchLogs()
      }
    })

    const unsubDisabled = window.electronAPI.onHeartbeatDisabled((event: unknown) => {
      const data = event as { taskId: string }
      if (data.taskId === task.id) {
        fetchStatus()
        fetchLogs()
      }
    })

    return () => {
      unsubAlert()
      unsubDisabled()
    }
  }, [task.id, fetchStatus, fetchLogs])

  // Show the section for tasks in ready_for_review so users can always create/edit heartbeat instructions
  // Also show if heartbeat is already enabled or a file exists
  if (!status?.hasHeartbeatFile && !status?.enabled && task.status !== 'ready_for_review') {
    return null
  }

  const handleEnable = async () => {
    setLoading(true)
    try {
      await window.electronAPI.heartbeat.enable(task.id)
      await fetchStatus()
      onTaskUpdated?.()
    } finally {
      setLoading(false)
    }
  }

  const handleDisable = async () => {
    setLoading(true)
    try {
      await window.electronAPI.heartbeat.disable(task.id)
      await fetchStatus()
      onTaskUpdated?.()
    } finally {
      setLoading(false)
    }
  }

  const handleRunNow = async () => {
    setLoading(true)
    try {
      await window.electronAPI.heartbeat.runNow(task.id)
      await fetchStatus()
      await fetchLogs()
      onTaskUpdated?.()
    } finally {
      setLoading(false)
    }
  }

  const handleIntervalChange = async (minutes: number) => {
    try {
      await window.electronAPI.heartbeat.updateInterval(task.id, minutes)
      await fetchStatus()
      onTaskUpdated?.()
    } catch {
      // Ignore
    }
  }

  const handleStartEdit = () => {
    setEditDraft(heartbeatContent || '# Heartbeat Checks\n- [ ] ')
    setEditing(true)
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setEditDraft('')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await window.electronAPI.heartbeat.writeFile(task.id, editDraft)
      setHeartbeatContent(editDraft.trim() || null)
      setEditing(false)
      // Refresh status since file existence may have changed
      await fetchStatus()
    } finally {
      setSaving(false)
    }
  }

  const lastLog = logs[0]
  const statusColor = !status?.enabled ? 'default'
    : lastLog?.status === HeartbeatStatus.Ok ? 'green'
    : lastLog?.status === HeartbeatStatus.AttentionNeeded ? 'yellow'
    : lastLog?.status === HeartbeatStatus.Error ? 'red'
    : 'blue'

  const statusLabel = !status?.enabled ? 'Disabled'
    : lastLog?.status === HeartbeatStatus.Ok ? 'OK'
    : lastLog?.status === HeartbeatStatus.AttentionNeeded ? 'Attention Needed'
    : lastLog?.status === HeartbeatStatus.Error ? 'Error'
    : 'Active'

  return (
    <div className="rounded-md border p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <HeartPulse className="h-4 w-4 text-rose-400" />
          <span>Heartbeat Monitor</span>
          <Badge variant={statusColor}>{statusLabel}</Badge>
        </button>
        <div className="flex items-center gap-1.5">
          {status?.enabled ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRunNow}
                disabled={loading}
                title="Run heartbeat check now"
              >
                <Play className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDisable}
                disabled={loading}
                title="Disable heartbeat"
              >
                <Pause className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleEnable}
              disabled={loading || !status?.hasHeartbeatFile}
              title={status?.hasHeartbeatFile ? 'Enable heartbeat' : 'No heartbeat.md file found'}
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              Enable
            </Button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3 pt-1">
          {/* Status details */}
          {status?.enabled && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3 w-3" /> Interval
              </span>
              <span>
                <select
                  value={status.intervalMinutes ?? 30}
                  onChange={(e) => handleIntervalChange(parseInt(e.target.value))}
                  className="bg-transparent border rounded px-1.5 py-0.5 text-xs"
                >
                  {INTERVAL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </span>
              {status.lastCheckAt && (
                <>
                  <span className="text-muted-foreground">Last check</span>
                  <span className="text-muted-foreground">{formatRelativeDate(status.lastCheckAt)}</span>
                </>
              )}
              {status.nextCheckAt && (
                <>
                  <span className="text-muted-foreground">Next check</span>
                  <span className="text-muted-foreground">{formatRelativeDate(status.nextCheckAt)}</span>
                </>
              )}
            </div>
          )}

          {/* Heartbeat.md content — editable */}
          <div className="text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-muted-foreground font-medium">heartbeat.md</span>
              {!editing ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleStartEdit}
                  className="h-5 px-1.5 text-[10px]"
                  title={heartbeatContent ? 'Edit heartbeat instructions' : 'Create heartbeat instructions'}
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  {heartbeatContent ? 'Edit' : 'Create'}
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSave}
                    disabled={saving}
                    className="h-5 px-1.5 text-[10px] text-emerald-500 hover:text-emerald-400"
                    title="Save changes"
                  >
                    <Save className="h-3 w-3 mr-1" />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCancelEdit}
                    disabled={saving}
                    className="h-5 px-1.5 text-[10px]"
                    title="Cancel editing"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
            {editing ? (
              <textarea
                ref={textareaRef}
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                className="w-full bg-muted/50 border border-border rounded p-2 font-mono text-[10px] leading-relaxed resize-y min-h-[80px] max-h-[200px] focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="# Heartbeat Checks&#10;- [ ] Check if PR has new review comments&#10;- [ ] Verify CI pipeline passed"
                spellCheck={false}
              />
            ) : heartbeatContent ? (
              <div
                className="bg-muted/50 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={handleStartEdit}
                title="Click to edit"
              >
                {heartbeatContent}
              </div>
            ) : (
              <div
                className="bg-muted/50 rounded p-2 text-muted-foreground/50 font-mono text-[10px] cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={handleStartEdit}
                title="Click to create heartbeat instructions"
              >
                No heartbeat.md — click to create one
              </div>
            )}
          </div>

          {/* Recent logs */}
          {logs.length > 0 && (
            <div className="text-xs">
              <button
                onClick={() => setLogsExpanded(!logsExpanded)}
                className="flex items-center gap-1 text-muted-foreground hover:text-foreground mb-1.5 font-medium"
              >
                {logsExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Recent Checks ({logs.length})
              </button>
              {logsExpanded && (
                <div className="space-y-1.5">
                  {logs.map((log) => (
                    <div key={log.id} className="flex items-start gap-2 bg-muted/30 rounded p-1.5">
                      <StatusIcon status={log.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={
                            log.status === HeartbeatStatus.Ok ? 'green'
                            : log.status === HeartbeatStatus.AttentionNeeded ? 'yellow'
                            : 'red'
                          }>
                            {log.status === HeartbeatStatus.Ok ? 'OK'
                             : log.status === HeartbeatStatus.AttentionNeeded ? 'Attention'
                             : 'Error'}
                          </Badge>
                          <span className="text-muted-foreground text-[10px] shrink-0">
                            {formatRelativeDate(log.created_at)}
                          </span>
                        </div>
                        {log.summary && log.status !== HeartbeatStatus.Ok && (
                          <p className="text-muted-foreground mt-0.5 line-clamp-2">{log.summary}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === HeartbeatStatus.Ok) {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
  }
  if (status === HeartbeatStatus.AttentionNeeded) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
  }
  return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
}
