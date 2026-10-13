export type RunStatus = 'running' | 'done' | 'stopped' | 'failed'

// Tokens one or more model calls used, as the API reports them.
export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type AgentRun = {
  id: string
  type: string
  description: string
  startedAt: number
  endedAt: number | null
  status: RunStatus
  lastTool: string | null
  tokens: Tokens
  // True once its tokens were added to its loop's saved total.
  banked: boolean
}

// One piece of work, written by the producer to .claude/loops/<id>.json
// (or the older single .claude/loop.json) as it moves through the loop.
export type LoopPlan = {
  id: string
  decision: string
  title: string
  stage: number
  stages: string[]
  next: string
  // "waiting" when it needs you, "done" when finished; otherwise worked out
  // from its agents.
  state?: 'running' | 'waiting' | 'done'
  notes?: Record<string, string>
  links?: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    'agent-board': {
      runs: AgentRun[]
      loops: LoopPlan[]
      selected: string | null
      showDone: boolean
      now: number
      // The main conversation's tokens this session; not split between loops.
      main: Tokens
      // Saved totals of finished agents, by loop id, for this project.
      banked: Record<string, Tokens>
    }
  }
}
