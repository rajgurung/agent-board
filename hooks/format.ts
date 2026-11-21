import type { AgentRun, LoopPlan, Tokens } from '../types'

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function bar(stage: number, total: number, width = 14): string {
  const ratio = total > 0 ? Math.min(1, Math.max(0, stage / total)) : 0
  const filled = Math.round(ratio * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function runTime(run: AgentRun, now: number): string {
  return elapsed((run.endedAt ?? now) - run.startedAt)
}

export const MARK: Record<AgentRun['status'], string> = {
  running: '●',
  done: '✓',
  stopped: '■',
  failed: '✗',
}

export const STATE_MARK = { running: '●', waiting: '◆', external: '◇', done: '✓' } as const

export type BoardState = keyof typeof STATE_MARK

const DAY = 24 * 60 * 60 * 1000
export const STALE_DAYS = 3

export function parseLoop(text: string, id = ''): LoopPlan | null {
  try {
    const raw = JSON.parse(text)
    if (typeof raw?.decision !== 'string' || !Array.isArray(raw?.stages)) return null
    const state = ['running', 'waiting', 'done'].includes(raw.state) ? raw.state : undefined
    const record = (value: unknown) =>
      value && typeof value === 'object' ? (value as Record<string, string>) : undefined
    return {
      id: id || raw.decision,
      decision: raw.decision,
      title: String(raw.title ?? ''),
      stage: Number(raw.stage ?? 0),
      stages: raw.stages.map(String),
      next: String(raw.next ?? ''),
      state,
      notes: record(raw.notes),
      links: record(raw.links),
      waitingOn: typeof raw.waiting_on === 'string' && raw.waiting_on.trim() !== '' ? raw.waiting_on.trim() : undefined,
    }
  } catch {
    return null
  }
}

// An agent belongs to a loop when its description starts with "<loop>: ",
// matching the loop's file name or its decision.
export function loopOf(run: AgentRun, loops: LoopPlan[]): string | null {
  const match = /^([\w-]+):\s/.exec(run.description)
  const key = match?.[1]?.toLowerCase()
  if (!key) return null
  return loops.find(loop => loop.id.toLowerCase() === key || loop.decision.toLowerCase() === key)?.id ?? null
}

export function runsFor(loop: LoopPlan, runs: AgentRun[], loops: LoopPlan[]): AgentRun[] {
  return runs.filter(run => loopOf(run, loops) === loop.id)
}

// A loop waits on the person unless its file names someone else (Apple, Google, a reviewer).
export function waitsOnYou(loop: LoopPlan): boolean {
  return loop.waitingOn === undefined || /^(you|me|user)$/i.test(loop.waitingOn)
}

export function stateOf(loop: LoopPlan, runs: AgentRun[], loops: LoopPlan[]): BoardState {
  if (loop.state === 'done') return 'done'
  if (runsFor(loop, runs, loops).some(run => run.status === 'running')) return 'running'
  const state = loop.state ?? 'waiting'
  return state === 'waiting' && !waitsOnYou(loop) ? 'external' : state
}

const ORDER = { waiting: 0, running: 1, external: 2, done: 3 } as const

// The words for a state: "waiting on you", "waiting on Apple".
export function stateLabel(loop: LoopPlan, state: BoardState): string {
  if (state === 'waiting') return 'waiting on you'
  if (state === 'external') return `waiting on ${loop.waitingOn}`
  return state
}

// Pull requests linked from a loop file, as { repo, number } (github.com URLs only).
export function pullRequests(loop: LoopPlan): { repo: string; number: number; url: string }[] {
  const found = new Map<string, { repo: string; number: number; url: string }>()
  for (const url of Object.values(loop.links ?? {})) {
    const m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(url)
    if (m) found.set(`${m[1]}#${m[2]}`, { repo: m[1]!, number: Number(m[2]), url })
  }
  return [...found.values()]
}

// What looks wrong with an open loop: a stage past the end, no update for days,
// or every linked PR merged while the file still says it's open.
export function warnings(loop: LoopPlan, state: BoardState, at: number, allMerged: boolean): string[] {
  if (state === 'done') return []
  const found: string[] = []
  if (loop.stages.length > 0 && (loop.stage > loop.stages.length || loop.stage < 1)) {
    found.push(`stage ${loop.stage} of ${loop.stages.length}`)
  }
  if (allMerged) found.push('PRs merged: close it?')
  if (loop.updatedAt !== undefined && at > 0) {
    const days = Math.floor((at - loop.updatedAt) / DAY)
    if (days >= STALE_DAYS) found.push(`no update for ${days}d`)
  }
  return found
}

// Waiting on you first, then running, then waiting on others, then done; file order within.
export function sortLoops(loops: LoopPlan[], runs: AgentRun[]): LoopPlan[] {
  return [...loops].sort((a, b) => ORDER[stateOf(a, runs, loops)] - ORDER[stateOf(b, runs, loops)])
}

// The text after the loop prefix, so rows don't repeat the loop's name.
export function shortDescription(run: AgentRun): string {
  return run.description.replace(/^[\w-]+:\s/, '')
}

export const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export function totalTokens(t: Tokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

// 950, 12.4k, 318k, 1.2M
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

// Share of the total that was read from the prompt cache, as a whole percent.
export function cacheShare(t: Tokens): number {
  const total = totalTokens(t)
  return total === 0 ? 0 : Math.round((t.cacheRead / total) * 100)
}

// A loop's tokens: its finished agents' saved total, plus agents not yet saved.
export function loopTokens(loop: LoopPlan, runs: AgentRun[], loops: LoopPlan[], banked: Record<string, Tokens>): Tokens {
  return runsFor(loop, runs, loops)
    .filter(run => !run.banked)
    .reduce((sum, run) => addTokens(sum, run.tokens), banked[loop.id] ?? NO_TOKENS)
}
