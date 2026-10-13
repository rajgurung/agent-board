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

export const STATE_MARK = { running: '●', waiting: '◆', done: '✓' } as const

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

export function stateOf(loop: LoopPlan, runs: AgentRun[], loops: LoopPlan[]): 'running' | 'waiting' | 'done' {
  if (loop.state === 'done') return 'done'
  if (runsFor(loop, runs, loops).some(run => run.status === 'running')) return 'running'
  return loop.state ?? 'waiting'
}

const ORDER = { waiting: 0, running: 1, done: 2 } as const

// Waiting on you first, then running, then done; most recent file order within.
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
