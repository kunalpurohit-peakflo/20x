/**
 * Database Worker Thread
 *
 * Runs better-sqlite3 in a separate thread so synchronous SQL calls
 * don't block the main Electron event loop. Receives method + args
 * via parentPort and returns results.
 *
 * Only hot-path CRUD operations are implemented here — initialization,
 * migrations, secret encryption, and the task-API server stay on the
 * main thread (they need Electron APIs and only run at startup / rarely).
 */
import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'

// ── Types (duplicated from database.ts to avoid Electron import) ───

interface TaskRow {
  id: string; title: string; description: string; type: string
  priority: string; status: string; assignee: string; due_date: string | null
  labels: string; checklist: string; attachments: string; repos: string
  output_fields: string; agent_id: string | null; external_id: string | null
  source_id: string | null; source: string; skill_ids: string | null
  session_id: string | null; snoozed_until: string | null
  resolution: string | null; feedback_rating: number | null
  feedback_comment: string | null; is_recurring: number
  recurrence_pattern: string | null; recurrence_parent_id: string | null
  last_occurrence_at: string | null; next_occurrence_at: string | null
  created_at: string; updated_at: string
}

interface AgentRow {
  id: string; name: string; server_url: string; config: string
  is_default: number; created_at: string; updated_at: string
}

interface McpServerRow {
  id: string; name: string; type: string; command: string; args: string
  url: string | null; headers: string; environment: string; tools: string
  created_at: string; updated_at: string
}

interface SkillRow {
  id: string; name: string; description: string; content: string
  version: number; confidence: number; uses: number; last_used: string | null
  tags: string; is_deleted: number; created_at: string; updated_at: string
}

interface SecretRow {
  id: string; name: string; description: string; env_var_name: string
  value: Buffer; created_at: string; updated_at: string
}

// ── Deserialization (mirrors database.ts) ──────────────────────────

function deserializeTask(row: TaskRow) {
  return {
    ...row,
    labels: JSON.parse(row.labels) as string[],
    attachments: JSON.parse(row.attachments),
    repos: JSON.parse(row.repos) as string[],
    output_fields: JSON.parse(row.output_fields || '[]'),
    agent_id: row.agent_id ?? null,
    external_id: row.external_id ?? null,
    source_id: row.source_id ?? null,
    skill_ids: row.skill_ids ? JSON.parse(row.skill_ids) as string[] : null,
    session_id: row.session_id ?? null,
    snoozed_until: row.snoozed_until ?? null,
    resolution: row.resolution ?? null,
    feedback_rating: row.feedback_rating ?? null,
    feedback_comment: row.feedback_comment ?? null,
    is_recurring: row.is_recurring === 1,
    recurrence_pattern: row.recurrence_pattern
      ? (row.recurrence_pattern.startsWith('{')
        ? JSON.parse(row.recurrence_pattern)
        : row.recurrence_pattern)
      : null,
    recurrence_parent_id: row.recurrence_parent_id ?? null,
    last_occurrence_at: row.last_occurrence_at ?? null,
    next_occurrence_at: row.next_occurrence_at ?? null
  }
}

function deserializeAgent(row: AgentRow) {
  return {
    ...row,
    config: JSON.parse(row.config),
    is_default: row.is_default === 1
  }
}

function deserializeMcpServer(row: McpServerRow) {
  return {
    ...row,
    type: (row.type as 'local' | 'remote') || 'local',
    args: JSON.parse(row.args) as string[],
    url: row.url ?? '',
    headers: JSON.parse(row.headers || '{}'),
    environment: JSON.parse(row.environment || '{}'),
    tools: JSON.parse(row.tools || '[]')
  }
}

function deserializeSkill(row: SkillRow) {
  let tags: string[] = []
  try { tags = JSON.parse(row.tags) } catch { tags = [] }
  return {
    id: row.id, name: row.name, description: row.description,
    content: row.content, version: row.version, confidence: row.confidence,
    uses: row.uses, last_used: row.last_used, tags,
    created_at: row.created_at, updated_at: row.updated_at
  }
}

function deserializeSecret(row: SecretRow) {
  return {
    id: row.id, name: row.name, description: row.description,
    env_var_name: row.env_var_name,
    created_at: row.created_at, updated_at: row.updated_at
  }
}

// ── Updatable columns (mirrors database.ts) ────────────────────────

const UPDATABLE_COLUMNS = new Set([
  'title', 'description', 'type', 'priority', 'status', 'assignee',
  'due_date', 'labels', 'attachments', 'repos', 'output_fields',
  'agent_id', 'skill_ids', 'session_id', 'snoozed_until',
  'feedback_rating', 'feedback_comment', 'is_recurring',
  'recurrence_pattern', 'last_occurrence_at', 'next_occurrence_at'
])

const JSON_COLUMNS = new Set(['labels', 'attachments', 'repos', 'output_fields', 'skill_ids'])

// ── Open database ──────────────────────────────────────────────────

const { dbPath } = workerData as { dbPath: string }

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000') // Wait up to 5s if main thread holds a write lock

// ── Method dispatch ────────────────────────────────────────────────

type MethodHandler = (...args: unknown[]) => unknown

const methods: Record<string, MethodHandler> = {
  // ── Tasks ──
  getTasks() {
    const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as TaskRow[]
    return rows.map(deserializeTask)
  },

  getTask(id: unknown) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id as string) as TaskRow | undefined
    return row ? deserializeTask(row) : undefined
  },

  updateTask(id: unknown, data: unknown) {
    const updates = data as Record<string, unknown>
    const setClauses: string[] = []
    const values: (string | number | null)[] = []

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || !UPDATABLE_COLUMNS.has(key)) continue
      setClauses.push(`${key} = ?`)
      if (JSON_COLUMNS.has(key)) {
        values.push(JSON.stringify(value))
      } else if (key === 'recurrence_pattern') {
        values.push(value === null ? null : typeof value === 'string' ? value : JSON.stringify(value))
      } else if (typeof value === 'boolean') {
        values.push(value ? 1 : 0)
      } else {
        values.push(value as string | number | null)
      }
    }

    if (setClauses.length === 0) return methods.getTask(id)

    setClauses.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id as string)

    db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
    return methods.getTask(id)
  },

  // ── Agents ──
  getAgents() {
    const rows = db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as AgentRow[]
    return rows.map(deserializeAgent)
  },

  getAgent(id: unknown) {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id as string) as AgentRow | undefined
    return row ? deserializeAgent(row) : undefined
  },

  // ── MCP Servers ──
  getMcpServers() {
    const rows = db.prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC').all() as McpServerRow[]
    return rows.map(deserializeMcpServer)
  },

  getMcpServer(id: unknown) {
    const row = db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id as string) as McpServerRow | undefined
    return row ? deserializeMcpServer(row) : undefined
  },

  // ── Skills ──
  getSkills() {
    const rows = db.prepare('SELECT * FROM skills WHERE is_deleted = 0 ORDER BY confidence DESC').all() as SkillRow[]
    return rows.map(deserializeSkill)
  },

  getSkillsByIds(ids: unknown) {
    const arr = ids as string[]
    if (!arr || arr.length === 0) return []
    const placeholders = arr.map(() => '?').join(',')
    const rows = db.prepare(`SELECT * FROM skills WHERE id IN (${placeholders}) AND is_deleted = 0 ORDER BY confidence DESC`).all(...arr) as SkillRow[]
    return rows.map(deserializeSkill)
  },

  // ── Secrets (metadata only — no decryption in worker) ──
  getSecretsByIds(ids: unknown) {
    const arr = ids as string[]
    if (!arr || arr.length === 0) return []
    const placeholders = arr.map(() => '?').join(',')
    const rows = db.prepare(`SELECT * FROM secrets WHERE id IN (${placeholders})`).all(...arr) as SecretRow[]
    return rows.map(deserializeSecret)
  },

  // ── Settings ──
  getSetting(key: unknown) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key as string) as { value: string } | undefined
    return row?.value
  },

  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const result: Record<string, string> = {}
    for (const row of rows) result[row.key] = row.value
    return result
  },

  // ── Utility ──
  close() {
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    return true
  }
}

// ── Message handler ────────────────────────────────────────────────

parentPort!.on('message', (msg: { id: string; method: string; args: unknown[] }) => {
  const { id, method, args } = msg

  const handler = methods[method]
  if (!handler) {
    parentPort!.postMessage({ id, error: `Unknown method: ${method}` })
    return
  }

  try {
    const result = handler(...args)
    parentPort!.postMessage({ id, result })
  } catch (err) {
    parentPort!.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err)
    })
  }
})

// Signal ready
parentPort!.postMessage({ type: 'ready' })
