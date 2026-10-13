import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, LoopPlan, RunStatus } from '../types'
import { CONVENTION } from './convention'
import {
  MARK,
  STATE_MARK,
  bar,
  loopOf,
  parseLoop,
  runTime,
  runsFor,
  shortDescription,
  sortLoops,
  stateOf,
} from './format'

const PANE = 'agent-board'
const LOOPS_DIR = '.claude/loops'
const LEGACY_FILE = '.claude/loop.json'
const OTHER = '__other__'
const BAND_LOOPS = 3

const runs = atom({ plugin: 'agent-board', key: 'runs' } as const, [] as AgentRun[])
const loops = atom({ plugin: 'agent-board', key: 'loops' } as const, [] as LoopPlan[])
const selected = atom({ plugin: 'agent-board', key: 'selected' } as const, null as string | null)
const showDone = atom({ plugin: 'agent-board', key: 'showDone' } as const, false)
const now = atom({ plugin: 'agent-board', key: 'now' } as const, 0)

const STATUS_COLOR = { running: 'warning', done: 'success', stopped: 'inactive', failed: 'error' } as const
const STATE_COLOR = { running: 'warning', waiting: 'claude', done: 'success' } as const

// Every loop file in .claude/loops, plus the older single loop.json.
async function readLoops($: EngineInterface): Promise<{ text: string; list: LoopPlan[] }> {
  const found: { id: string; text: string }[] = []
  if (await $.fs.exists(LOOPS_DIR)) {
    const entries = await $.fs.list(LOOPS_DIR)
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      const text = await $.fs.read(`${LOOPS_DIR}/${entry.name}`)
      found.push({ id: entry.name.replace(/\.json$/, ''), text: String(text) })
    }
  }
  if (await $.fs.exists(LEGACY_FILE)) found.push({ id: '', text: String(await $.fs.read(LEGACY_FILE)) })
  found.sort((a, b) => a.id.localeCompare(b.id))
  const list = found.map(f => parseLoop(f.text, f.id)).filter((p): p is LoopPlan => p !== null)
  return { text: found.map(f => f.id + f.text).join('\n'), list }
}


export const register: Register = on => {
  let lastText: string | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'board', description: 'Show every loop and its agents' })
    const t = await $.clock.now()
    await update($, now, () => t)

    // Tick the clock only while something runs, so idle sessions do not redraw.
    $.clock.every(1000, async () => {
      const { value = [] } = await $.state.get({ plugin: 'agent-board', key: 'runs' } as const)
      if (value.some(run => run.status === 'running')) {
        const t = await $.clock.now()
        await update($, now, () => t)
      }
    })

    $.clock.every(2000, async () => {
      const { text, list } = await readLoops($)
      if (text === lastText) return
      lastText = text
      await update($, loops, () => list)
    })

    return next(e)
  })

  // Teaches Claude the loop-file convention the board reads.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    return { sections: [...result.sections, { id: 'agent-board:convention', text: CONVENTION, scope: 'session' }] }
  })

  on('command.run', { command: 'board' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent board', focus: true })
    return { text: 'Agent board opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId) {
      const t = await $.clock.now()
      const run: AgentRun = {
        id: started.agentId,
        type: e.subagentType,
        description: e.description,
        startedAt: t,
        endedAt: null,
        status: 'running',
        lastTool: null,
      }
      await update($, runs, list => [...list, run].slice(-100))
      await update($, now, () => t)
    }
    return started
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      await update($, runs, list =>
        list.map(run => (run.id === id && run.status === 'running' ? { ...run, lastTool: e.tool } : run)),
      )
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      const status: RunStatus = e.isAborted ? 'stopped' : e.reason === 'error' ? 'failed' : 'done'
      const endedAt = await $.clock.now()
      await update($, runs, list =>
        list.map(run => (run.id === id && run.status === 'running' ? { ...run, status, endedAt } : run)),
      )
      await update($, now, () => endedAt)
    }
    return next(e)
  })

  // One line per open loop: what stage it's at, and who is working on it or what it waits for.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, loops)
    const list = await read($, runs)
    const at = await read($, now)
    const open = sortLoops(all, list).filter(loop => stateOf(loop, list, all) !== 'done')
    const strays = list.filter(run => run.status === 'running' && loopOf(run, all) === null)

    if (e.props.hasSurvey || (open.length === 0 && strays.length === 0)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(8, ...open.map(loop => loop.id.length))

    return (
      <Box flexDirection="column">
        {open.slice(0, BAND_LOOPS).map(loop => {
          const state = stateOf(loop, list, all)
          const busy = runsFor(loop, list, all).filter(run => run.status === 'running')
          return (
            <Text key={loop.id} wrap="truncate-end">
              <Text color={STATE_COLOR[state]}>{STATE_MARK[state]}</Text> <Text bold>{loop.id.padEnd(width)}</Text>{' '}
              {(loop.stages[loop.stage - 1] ?? '').padEnd(14)}
              <Text color="claude">{bar(loop.stage, loop.stages.length, 8)}</Text> {loop.stage}/{loop.stages.length}
              {'  '}
              {busy.length > 0 ? (
                busy.map(run => `${run.type} ${runTime(run, at)}`).join(', ')
              ) : (
                <Text dimColor>{state === 'waiting' ? `waiting: ${loop.next}` : loop.next}</Text>
              )}
            </Text>
          )
        })}
        {(open.length > BAND_LOOPS || strays.length > 0) && (
          <Text dimColor wrap="truncate-end">
            {open.length > BAND_LOOPS ? `+${open.length - BAND_LOOPS} more  ` : ''}
            {strays.length > 0 ? `${strays.length} other agent${strays.length > 1 ? 's' : ''} running  ` : ''}· /board
          </Text>
        )}
      </Box>
    )
  })

  // Loops on the left (press one to open it), the open loop's detail on the right.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, loops)
    const list = await read($, runs)
    const at = await read($, now)
    const wantDone = await read($, showDone)
    const chosen = await read($, selected)

    const sorted = sortLoops(all, list)
    const done = sorted.filter(loop => stateOf(loop, list, all) === 'done')
    const shown = wantDone ? sorted : sorted.filter(loop => stateOf(loop, list, all) !== 'done')
    const strays = list.filter(run => loopOf(run, all) === null)
    const current = chosen === OTHER ? OTHER : (sorted.find(loop => loop.id === chosen) ?? shown[0] ?? null)
    const narrow = (e.viewport?.columns ?? 120) < 100

    const choose = (id: string) => () => update($, selected, () => id)

    const sidebar = (
      <Box flexDirection="column" width={narrow ? undefined : 30} marginRight={narrow ? 0 : 2}>
        <Text bold>Loops</Text>
        {shown.length === 0 && <Text dimColor>None open.</Text>}
        {shown.map(loop => {
          const state = stateOf(loop, list, all)
          const isOn = current !== OTHER && current?.id === loop.id
          return (
            <Button key={`loop-${loop.id}`} plain onPress={choose(loop.id)}>
              <Text color={STATE_COLOR[state]}>{STATE_MARK[state]}</Text>{' '}
              <Text bold={isOn}>{loop.id}</Text> <Text dimColor>{loop.stage}/{loop.stages.length}</Text>
            </Button>
          )
        })}
        {strays.length > 0 && (
          <Button key="loop-other" plain onPress={choose(OTHER)}>
            <Text bold={current === OTHER}>Other agents</Text> <Text dimColor>{strays.length}</Text>
          </Button>
        )}
        {done.length > 0 && (
          <Button key="toggle-done" plain onPress={() => update($, showDone, v => !v)}>
            <Text dimColor>{wantDone ? 'Hide done' : `Show done (${done.length})`}</Text>
          </Button>
        )}
        <Text dimColor>◆ waiting on you  ● running  ✓ done</Text>
      </Box>
    )

    const agentRows = (rows: AgentRun[]) =>
      rows.length === 0 ? (
        <Text dimColor>No agents yet.</Text>
      ) : (
        rows.map(run => (
          <Text key={run.id} wrap="truncate-end">
            <Text color={STATUS_COLOR[run.status]}>{MARK[run.status]}</Text> {run.type.slice(0, 18).padEnd(19)}
            {runTime(run, at).padEnd(8)}
            {run.status === 'running' && run.lastTool ? <Text dimColor>{run.lastTool} · </Text> : ''}
            {shortDescription(run)}
          </Text>
        ))
      )

    let detail
    if (current === OTHER) {
      detail = (
        <Box flexDirection="column">
          <Text bold>Other agents</Text>
          <Text dimColor>Agents whose description has no loop prefix.</Text>
          <Text> </Text>
          {agentRows(strays)}
        </Box>
      )
    } else if (current === null) {
      detail = (
        <Text dimColor>
          No loops yet. Add a file per piece of work in {LOOPS_DIR}/, and start each agent's description with
          {'"<loop>: "'}.
        </Text>
      )
    } else {
      const state = stateOf(current, list, all)
      const mine = runsFor(current, list, all)
      const ran = new Set(mine.map(run => run.type))
      const planned = Object.entries(current.notes ?? {}).filter(([agent]) => !ran.has(agent))
      detail = (
        <Box flexDirection="column">
          <Text bold>
            {current.id}: {current.title}
          </Text>
          <Text>
            <Text color={STATE_COLOR[state]}>
              {STATE_MARK[state]} {state === 'waiting' ? 'waiting on you' : state}
            </Text>
            {'   '}
            <Text color="claude">{bar(current.stage, current.stages.length, 20)}</Text> {current.stage}/
            {current.stages.length} {current.stages[current.stage - 1] ?? ''}
          </Text>
          <Text dimColor wrap="wrap">
            {current.stages
              .map((name, i) => (i + 1 < current.stage ? `✓ ${name}` : i + 1 === current.stage ? `[${name}]` : name))
              .join(' → ')}
          </Text>
          {current.next !== '' && (
            <Text wrap="wrap">
              <Text bold>Next:</Text> {current.next}
            </Text>
          )}
          <Text> </Text>
          <Text bold>Agents</Text>
          {agentRows(mine)}
          {planned.map(([agent, note]) => (
            <Text key={`note-${agent}`} dimColor wrap="truncate-end">
              ○ {agent.slice(0, 18).padEnd(19)}
              {'-'.padEnd(8)}
              {note}
            </Text>
          ))}
          {current.links && Object.keys(current.links).length > 0 && (
            <Box flexDirection="column">
              <Text> </Text>
              <Text bold>Links</Text>
              {Object.entries(current.links).map(([name, url]) => (
                <Text key={`link-${name}`} wrap="truncate-end">
                  {name}: <Text color="claude">{url}</Text>
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection={narrow ? 'column' : 'row'}>
        {sidebar}
        {narrow && <Text> </Text>}
        <Box flexDirection="column" flexGrow={1}>
          {detail}
        </Box>
      </Box>
    )
  })
}
