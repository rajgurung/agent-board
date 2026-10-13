import { expect, test } from 'claude-code/testing'

import type { AgentRun, LoopPlan } from '../types'
import { CONVENTION } from './convention'
import {
  NO_TOKENS,
  addTokens,
  bar,
  cacheShare,
  elapsed,
  formatTokens,
  loopOf,
  loopTokens,
  parseLoop,
  shortDescription,
  sortLoops,
  stateOf,
  totalTokens,
} from './format'

const loop = (id: string, extra: Partial<LoopPlan> = {}): LoopPlan => ({
  id,
  decision: id,
  title: id,
  stage: 1,
  stages: ['Plan', 'Build'],
  next: '',
  ...extra,
})
const run = (description: string, status: AgentRun['status'] = 'running'): AgentRun => ({
  id: description,
  type: 'staff-engineer',
  description,
  startedAt: 0,
  endedAt: status === 'running' ? null : 1,
  status,
  lastTool: null,
  tokens: NO_TOKENS,
  banked: false,
})

test('formats elapsed time', () => {
  expect(elapsed(9_000)).toBe('9s')
  expect(elapsed(94_000)).toBe('1m 34s')
  expect(elapsed(3_720_000)).toBe('1h 02m')
})

test('draws the stage bar', () => {
  expect(bar(2, 7, 14)).toBe('████░░░░░░░░░░')
  expect(bar(7, 7, 4)).toBe('████')
  expect(bar(0, 0, 4)).toBe('░░░░')
})

test('parses a loop file, its id, state and links, and rejects a bad one', () => {
  const plan = parseLoop(
    JSON.stringify({ decision: '0001', title: 'C++ or Blueprint', stage: 2, stages: ['Propose', 'Review'], next: 'merge', state: 'waiting', links: { PR: 'https://x' } }),
    'gameplay',
  )
  expect(plan?.id).toBe('gameplay')
  expect(plan?.state).toBe('waiting')
  expect(plan?.links?.PR).toBe('https://x')
  expect(parseLoop(JSON.stringify({ decision: 'a', stages: [] }))?.id).toBe('a')
  expect(parseLoop(JSON.stringify({ decision: 'a', stages: [], state: 'nonsense' }))?.state).toBe(undefined)
  expect(parseLoop('{not json')).toBe(null)
  expect(parseLoop('{"title":"no decision"}')).toBe(null)
})

test('groups agents by the loop prefix in their description', () => {
  const loops = [loop('drop'), loop('homepage', { decision: 'homepage-documents' })]
  expect(loopOf(run('drop: Build drag-and-drop'), loops)).toBe('drop')
  expect(loopOf(run('homepage-documents: Designer mockup'), loops)).toBe('homepage')
  expect(loopOf(run('Drop: case does not matter'), loops)).toBe('drop')
  expect(loopOf(run('Build drag-and-drop'), loops)).toBe(null)
  expect(loopOf(run('unknown: something'), loops)).toBe(null)
  expect(shortDescription(run('drop: Build drag-and-drop'))).toBe('Build drag-and-drop')
})

test('works out each loop state and sorts waiting first', () => {
  const loops = [loop('a'), loop('b', { state: 'done' }), loop('c', { state: 'waiting' }), loop('d')]
  const runs = [run('a: building'), run('d: finished', 'done')]
  expect(stateOf(loops[0]!, runs, loops)).toBe('running')
  expect(stateOf(loops[1]!, runs, loops)).toBe('done')
  expect(stateOf(loops[2]!, runs, loops)).toBe('waiting')
  expect(stateOf(loops[3]!, runs, loops)).toBe('waiting')
  expect(sortLoops(loops, runs).map(l => l.id)).toEqual(['c', 'd', 'a', 'b'])
})

test('passes agent spawns through unchanged', async ($, on) => {
  on('agent.spawn', () => ({ model: 'test-model', agentId: 'agent-1' }))
  const started = await $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'check sources',
    description: 'drop: Review',
    subagentType: 'staff-reviewer',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'test-model',
    background: true,
    fork: false,
  })
  expect(started.agentId).toBe('agent-1')
})

test('the prompt convention describes a loop file the board can read', () => {
  const example = /The file is JSON: (\{.*\})$/m.exec(CONVENTION)?.[1] ?? ''
  const plan = parseLoop(example, 'threads')
  expect(plan?.stages).toEqual(['Plan', 'Build', 'Review', 'PR'])
  expect(plan?.state).toBe('running')
  expect(loopOf(run('threads: Review the plan'), [plan!])).toBe('threads')
})

test('formats token counts', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_400)).toBe('12.4k')
  expect(formatTokens(40_000)).toBe('40k')
  expect(formatTokens(317_416)).toBe('317k')
  expect(formatTokens(1_240_000)).toBe('1.2M')
})

test('a loop total is its saved tokens plus agents not yet saved', () => {
  const t = (n: number) => ({ input: n, output: 0, cacheRead: 3 * n, cacheWrite: 0 })
  const plan = loop('threads')
  const runs = [
    { ...run('threads: Build PR 2'), tokens: t(100), banked: false },
    { ...run('threads: Write the brief', 'done'), tokens: t(50), banked: true },
    { ...run('other: Something'), tokens: t(999), banked: false },
  ]
  const total = loopTokens(plan, runs, [plan], { threads: t(1000) })
  expect(totalTokens(total)).toBe(4400)
  expect(cacheShare(total)).toBe(75)
  expect(totalTokens(addTokens(NO_TOKENS, t(1)))).toBe(4)
})
