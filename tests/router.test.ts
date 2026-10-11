import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { classify, isCheaper } from '../hooks/classify'

const OPUS = 'claude-opus-5-5'

describe('classify', () => {
  test('sorts prompts into tiers', () => {
    expect(classify('where is the auth middleware defined?').tier).toBe('light')
    expect(classify('rename getUser to fetchUser').tier).toBe('light')
    expect(classify('add a delete button to the settings page').tier).toBe('standard')
    expect(classify('design the architecture for multi-tenant billing').tier).toBe('heavy')
    expect(classify('investigate the race condition in the job queue').tier).toBe('heavy')
    expect(classify('yes, go ahead').tier).toBe('follow-up')
    expect(classify('').tier).toBe('follow-up')
  })

  test('never routes up or to an unknown model', () => {
    expect(isCheaper('haiku', OPUS)).toBe(true)
    expect(isCheaper('sonnet', 'claude-sonnet-5-5')).toBe(false)
    expect(isCheaper('opus', 'claude-haiku-5-5')).toBe(false)
    expect(isCheaper('haiku', 'gpt-5')).toBe(false)
  })
})

const spawn = (subagentType: string, prompt: string, model?: string) => ({
  tool_use_id: 'toolu_1',
  prompt,
  description: 'task',
  subagentType,
  provider: { plugin: 'engine', tier: 'core' as const },
  model,
  parentModel: OPUS,
  background: false,
  fork: false,
})

const HAIKU = 'claude-haiku-4-5'
const SONNET = 'claude-sonnet-5-5'
const IDS = { lightModel: HAIKU, standardModel: SONNET }

// Stands for the engine: answers every model except the one named as gone.
function bottom(on: On, gone = 'claude-haiku-gone') {
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($, e) {
    const usage = e.model !== gone
      ? { model: e.model, input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      : null
    return { turnId: e.turnId, index: e.index, answer: e.model, toolUses: [], stopReason: usage ? 'end_turn' : null, usage }
  })
}

describe('main loop', () => {
  async function stepModel($: Engine, turnId: string, text: string, index = 0) {
    await $.turn.start({ text, turnId })
    const stream = $.turn.step({ turnId, index, model: OPUS, messageCount: 1 })
    let step = await stream.next()
    while (!step.done) step = await stream.next()

    return step.value.answer
  }

  test('never sends a bare alias to the main loop', async ($, on) => {
    bottom(on)

    expect(await stepModel($, 't1', 'explain what this regex does')).toBe(OPUS)
    expect(await stepModel($, 't2', 'add pagination to the users endpoint')).toBe(OPUS)
  })

  test('routes by tier with full ids, a follow-up inherits', { options: IDS }, async ($, on) => {
    bottom(on)

    expect(await stepModel($, 't1', 'explain what this regex does')).toBe(HAIKU)
    expect(await stepModel($, 't2', 'plan the migration to postgres')).toBe(OPUS)
    expect(await stepModel($, 't3', 'add pagination to the users endpoint')).toBe(SONNET)
    expect(await stepModel($, 't4', 'ok')).toBe(SONNET)
  })

  test('learns an id from a spawn, then routes the main loop with it', async ($, on) => {
    bottom(on)
    on('agent.spawn', ($, e) => ({ model: e.model === 'haiku' ? HAIKU : e.parentModel }))

    await $.agent.spawn(spawn('Explore', 'map the repo'))
    expect(await stepModel($, 't1', 'explain what this regex does')).toBe(HAIKU)
  })

  test('falls back to the session model when the cheap one gives no answer', { options: { lightModel: 'claude-haiku-gone' } }, async ($, on) => {
    bottom(on)

    expect(await stepModel($, 't1', 'explain what this regex does')).toBe(OPUS)
    expect(await stepModel($, 't2', 'explain this function')).toBe(OPUS)
  })

  test('a long light turn escalates', { options: IDS }, async ($, on) => {
    bottom(on)

    expect(await stepModel($, 't1', 'find the config loader', 12)).toBe(SONNET)
  })

  test('subagents mode leaves the main loop alone', { options: { ...IDS, mode: 'subagents' } }, async ($, on) => {
    bottom(on)

    expect(await stepModel($, 't1', 'explain what this regex does')).toBe(OPUS)
  })
})

describe('subagents', () => {

  test('routes Explore to haiku and respects an explicit model', async ($, on) => {
    on('agent.spawn', ($, e) => ({ model: e.model ?? e.parentModel }))

    expect((await $.agent.spawn(spawn('Explore', 'map the repo'))).model).toBe('haiku')
    expect((await $.agent.spawn(spawn('general-purpose', 'write tests for the parser'))).model).toBe('sonnet')
    expect((await $.agent.spawn(spawn('general-purpose', 'design a caching strategy'))).model).toBe(OPUS)
    expect((await $.agent.spawn(spawn('Explore', 'map the repo', 'opus'))).model).toBe('opus')
    expect((await $.agent.spawn(spawn('ecc:code-reviewer', 'review this diff'))).model).toBe(OPUS)
  })
})
