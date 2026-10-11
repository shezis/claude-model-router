import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import { bump, classify, family, isCheaper, isModelId, type Tier } from './classify'

type Mode = 'auto' | 'subagents' | 'off'

const MODES: readonly Mode[] = ['auto', 'subagents', 'off']

// Descriptive labels give the small classifier model something to reason over.
const LABELS: Record<string, Tier> = {
  'simple lookup, explanation or small edit': 'light',
  'routine coding task': 'standard',
  'complex design, debugging or multi-file work': 'heavy',
}

type Tally = { requests: number; input: number; output: number; cacheRead: number }

type Routing = { lastTier: Tier; useClassifier: boolean; lightModel: string }

async function tierOf($: EngineInterface, text: string, r: Routing): Promise<Tier> {
  const verdict = classify(text)
  if (verdict.tier === 'follow-up') return r.lastTier
  if (verdict.isSure || !r.useClassifier) return verdict.tier

  try {
    const label = await $.model.classify(text.slice(0, 4000), Object.keys(LABELS), {
      model: r.lightModel,
    })

    return (label && LABELS[label]) || verdict.tier
  } catch {
    return verdict.tier
  }
}

export const register: Register = (on, options) => {
  let mode = (MODES.find(m => m === options.mode) ?? 'auto') as Mode
  const lightModel = String(options.lightModel ?? 'haiku')
  const standardModel = String(options.standardModel ?? 'sonnet')
  const escalateAfter = Number(options.escalateAfterSteps ?? 12)
  const useClassifier = options.useClassifier === true
  const routedAgents = new Set(
    String(options.routedAgents ?? 'general-purpose,Explore,claude')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )

  // Heavy work keeps whatever model the session or agent would have used.
  const modelFor = (tier: Tier): string | undefined =>
    tier === 'light' ? lightModel : tier === 'standard' ? standardModel : undefined

  // The main loop sends its model name to the API as given, so an alias must
  // become a real id first. Ids are learned from what the engine reports: a
  // spawn's resolved model and every response's answering model.
  const knownIds = new Map<string, string>()
  const learn = (model: string) => {
    const name = family(model)
    if (name && isModelId(model)) knownIds.set(name, model)
  }
  const idFor = (model: string): string | undefined => {
    if (isModelId(model)) return model
    const name = family(model)

    return name === undefined ? undefined : knownIds.get(name)
  }

  // A routed main-loop request that got no answer turns main-loop routing off for the session.
  let mainLoopBroken: string | undefined

  // A bare "yes" or "continue" belongs to the task before it.
  let lastTier: Tier = 'heavy'
  const turnTiers = new Map<string, Tier>()
  const routing = (): Routing => ({ lastTier, useClassifier, lightModel })
  const stats = { steps: 0, stepsRouted: 0, stepsWaiting: 0, spawns: 0, spawnsRouted: 0 }
  const byModel = new Map<string, Tally>()

  function tally(usage: TurnUsage) {
    learn(usage.model)
    const t = byModel.get(usage.model) ?? { requests: 0, input: 0, output: 0, cacheRead: 0 }
    t.requests += 1
    t.input += usage.input_tokens + (usage.cache_creation_input_tokens ?? 0)
    t.cacheRead += usage.cache_read_input_tokens ?? 0
    t.output += usage.output_tokens
    byModel.set(usage.model, t)
  }

  function report(): string {
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
    const lines = [
      `Model router: ${mode}`,
      `Main-loop requests routed down: ${stats.stepsRouted} of ${stats.steps}`,
      `Subagents routed down: ${stats.spawnsRouted} of ${stats.spawns}`,
    ]
    if (stats.stepsWaiting > 0) {
      lines.push(
        `Main-loop requests left alone for want of a model id: ${stats.stepsWaiting} (set full ids in the plugin's settings to route them)`,
      )
    }
    if (mainLoopBroken) lines.push(`Main-loop routing paused: ${mainLoopBroken} gave no answer`)
    if (knownIds.size > 0) {
      lines.push(`Known ids: ${[...knownIds.values()].join(', ')}`)
    }
    if (byModel.size > 0) {
      lines.push('', 'Tokens by model (input / cache read / output):')
      for (const [model, t] of byModel) {
        lines.push(`  ${model}: ${t.requests} req, ${k(t.input)} / ${k(t.cacheRead)} / ${k(t.output)}`)
      }
    }

    return lines.join('\n')
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Model router: show what was routed, or set the mode',
      argumentHint: '[auto | subagents | off]',
    })

    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const picked = MODES.find(m => m === arg)
    if (picked) {
      mode = picked
      mainLoopBroken = undefined
      $.ui.status(mode === 'off' ? undefined : `route: ${mode}`)

      return { text: `Model router set to ${mode} for this session.` }
    }
    if (arg !== '' && arg !== 'stats') return { text: 'Usage: /route [auto | subagents | off]' }

    return { text: report() }
  })

  on('turn.start', async ($, e, next) => {
    if (mode === 'auto') {
      lastTier = await tierOf($, e.text, routing())
      turnTiers.set(e.turnId, lastTier)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    learn(e.model)
    if (mode !== 'auto' || mainLoopBroken !== undefined || e.agentId !== undefined) {
      const result = yield* next(e)
      if (result.usage) tally(result.usage)

      return result
    }

    const planned = turnTiers.get(e.turnId) ?? lastTier
    const tier = e.index >= escalateAfter && planned !== 'heavy' ? bump(planned) : planned
    const wanted = modelFor(tier)
    const target = wanted === undefined ? undefined : idFor(wanted)
    const isRouted = target !== undefined && isCheaper(target, e.model)

    stats.steps += 1
    if (wanted !== undefined && target === undefined && isCheaper(wanted, e.model)) stats.stepsWaiting += 1
    if (e.index === 0 || e.index === escalateAfter) {
      $.ui.status(isRouted ? `route: ${tier} → ${target}` : `route: ${tier}`)
    }

    if (!isRouted) {
      const result = yield* next(e)
      if (result.usage) tally(result.usage)

      return result
    }

    stats.stepsRouted += 1
    const stream = next({ ...e, model: target })
    let hasYielded = false
    let step = await stream.next()
    while (!step.done) {
      hasYielded = true
      yield step.value
      step = await stream.next()
    }
    if (step.value.usage) {
      tally(step.value.usage)

      return step.value
    }

    // No answer from the cheaper model: stop routing the main loop, and when
    // nothing reached the transcript yet, ask the session's own model instead.
    mainLoopBroken = target
    stats.stepsRouted -= 1
    $.ui.toast(`model-router: ${target} gave no answer; main-loop routing paused (/route auto to retry)`)
    if (hasYielded) return step.value

    const result = yield* next(e)
    if (result.usage) tally(result.usage)

    return result
  })

  on('turn.complete', ($, e, next) => {
    turnTiers.delete(e.turnId)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    stats.spawns += 1

    // An explicit model from the caller, or an agent type we were not told to touch, stands.
    if (mode === 'off' || e.model !== undefined || !routedAgents.has(e.subagentType)) {
      const spawned = await next(e)
      if (spawned.model) learn(spawned.model)

      return spawned
    }

    const tier = e.subagentType === 'Explore' ? 'light' : await tierOf($, e.prompt, routing())
    const target = modelFor(tier)
    if (target === undefined || !isCheaper(target, e.parentModel)) return next(e)

    stats.spawnsRouted += 1
    const spawned = await next({ ...e, model: target })
    if (spawned.model) learn(spawned.model)

    return spawned
  })
}
