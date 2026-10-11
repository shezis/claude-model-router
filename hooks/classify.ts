export type Tier = 'light' | 'standard' | 'heavy'

export type Verdict = { tier: Tier | 'follow-up'; isSure: boolean }

const HEAVY =
  /\b(architect\w*|design|plan|strategy|trade-?offs?|migrat\w*|security|vulnerab\w*|race conditions?|deadlocks?|concurren\w*|performance|optimi[sz]\w*|root cause|why (?:does|is|did|do)|investigate|debug\w*|across the (?:codebase|repo)|multi-?file|rewrite|from scratch|end[- ]to[- ]end|scalab\w*|overhaul)\b/gi

const LIGHT =
  /\b(what is|what's|where is|where are|find|list|show me|explain|summari[sz]e|rename|typos?|format|lint|comments?|docstrings?|readme|grep|search|look ?up|which files?|how many|translate|spelling|commit message|bump|version)\b/gi

const FOLLOW_UP =
  /^(?:(?:y|yes|yep|yeah|ok|okay|sure|go|go ahead|do it|continue|proceed|next|thanks|thank you|lgtm|sounds good|please do|keep going)[,.!\s]*)+$/i

const LONG = 2000

function hits(pattern: RegExp, text: string): number {
  return new Set([...text.matchAll(pattern)].map(m => m[0].toLowerCase())).size
}

/** Sorts a prompt into a tier by keywords alone: free, instant, and sure only when one side is silent. */
export function classify(text: string): Verdict {
  const trimmed = text.trim()
  if (trimmed === '' || FOLLOW_UP.test(trimmed)) return { tier: 'follow-up', isSure: true }

  const heavy = hits(HEAVY, trimmed)
  const light = hits(LIGHT, trimmed)

  if (heavy > 0 && heavy >= light) return { tier: 'heavy', isSure: light === 0 }
  if (light > 0 && heavy === 0 && trimmed.length < LONG) return { tier: 'light', isSure: true }

  return { tier: 'standard', isSure: false }
}

export function bump(tier: Tier): Tier {
  return tier === 'light' ? 'standard' : 'heavy'
}

const FAMILY = ['haiku', 'sonnet', 'opus', 'fable']

function rank(model: string): number {
  const name = model.toLowerCase()

  return FAMILY.findIndex(family => name.includes(family))
}

/** `haiku` for `claude-haiku-4-5` or `haiku`; undefined for a model outside the known families. */
export function family(model: string): string | undefined {
  return FAMILY[rank(model)]
}

/** A full id (`claude-sonnet-5-5`) rather than an alias (`sonnet`): the main loop only accepts ids. */
export function isModelId(model: string): boolean {
  return /^claude-|\d/.test(model)
}

/** True only when both models are known Claude families and `target` sits below `ceiling`. */
export function isCheaper(target: string, ceiling: string): boolean {
  const low = rank(target)
  const high = rank(ceiling)

  return low >= 0 && high >= 0 && low < high
}
