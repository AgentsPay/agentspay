type GuardLevel = 'allow' | 'warn' | 'block'

type PatternRule = {
  id: string
  regex: RegExp
  weight: number
  level: 'high' | 'medium'
  reason: string
}

export type PromptGuardFinding = {
  id: string
  level: 'high' | 'medium'
  reason: string
}

export type PromptGuardResult = {
  enabled: boolean
  level: GuardLevel
  score: number
  findings: PromptGuardFinding[]
  excerpt: string
}

const HIGH_RULES: PatternRule[] = [
  {
    id: 'override_instructions',
    regex: /\b(ignore|bypass|override)\b.{0,40}\b(previous|prior|system|developer)\b.{0,40}\b(instruction|prompt|rule)s?\b/i,
    weight: 45,
    level: 'high',
    reason: 'Instruction override attempt',
  },
  {
    id: 'reveal_secrets',
    regex: /\b(reveal|show|leak|exfiltrat(e|ion)|dump)\b.{0,40}\b(api[\s_-]?key|private[\s_-]?key|seed\s?phrase|mnemonic|token|secret|password)\b/i,
    weight: 50,
    level: 'high',
    reason: 'Secret exfiltration language',
  },
  {
    id: 'tool_abuse_shell',
    regex: /\b(run|execute)\b.{0,30}\b(shell|powershell|bash|cmd|terminal|script)\b/i,
    weight: 35,
    level: 'high',
    reason: 'Tool execution coercion',
  },
  {
    id: 'metadata_ssrf',
    regex: /\b(169\.254\.169\.254|metadata\.google|aws metadata|azure metadata|gcp metadata)\b/i,
    weight: 50,
    level: 'high',
    reason: 'Metadata/SSRF target reference',
  },
  {
    id: 'system_prompt_request',
    regex: /\b(show|print|return|disclose)\b.{0,30}\b(system\s?prompt|developer\s?prompt|hidden\s?prompt)\b/i,
    weight: 45,
    level: 'high',
    reason: 'Hidden prompt extraction attempt',
  },
]

const MEDIUM_RULES: PatternRule[] = [
  {
    id: 'role_escalation',
    regex: /\b(you are now|act as|pretend to be)\b.{0,40}\b(system|root|admin|developer)\b/i,
    weight: 20,
    level: 'medium',
    reason: 'Role escalation phrasing',
  },
  {
    id: 'disable_safety',
    regex: /\b(disable|turn off|ignore)\b.{0,40}\b(safety|security|guardrails?|policy)\b/i,
    weight: 25,
    level: 'medium',
    reason: 'Safety bypass language',
  },
  {
    id: 'data_exfiltration_general',
    regex: /\b(send|export|upload|forward)\b.{0,40}\b(all data|full context|conversation|history)\b/i,
    weight: 20,
    level: 'medium',
    reason: 'Broad data exfiltration language',
  },
]

function toBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue
  return value === 'true' || value === '1'
}

function toNumber(value: string | undefined, defaultValue: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : defaultValue
}

function collectStrings(input: unknown, maxNodes: number, maxStringChars: number): string[] {
  const out: string[] = []
  const queue: unknown[] = [input]
  let seen = 0

  while (queue.length > 0 && seen < maxNodes) {
    const current = queue.shift()
    seen += 1
    if (current === null || current === undefined) continue

    if (typeof current === 'string') {
      out.push(current.slice(0, maxStringChars))
      continue
    }

    if (typeof current === 'number' || typeof current === 'boolean') continue
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item)
      continue
    }
    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>
      for (const [k, v] of Object.entries(obj)) {
        out.push(k.slice(0, 120))
        queue.push(v)
      }
    }
  }

  return out
}

export function inspectPromptInjection(payload: unknown): PromptGuardResult {
  const enabled = toBool(process.env.PROMPT_GUARD_ENABLED, true)
  if (!enabled) {
    return { enabled: false, level: 'allow', score: 0, findings: [], excerpt: '' }
  }

  const maxNodes = Math.max(50, Math.min(5000, toNumber(process.env.PROMPT_GUARD_MAX_NODES, 1200)))
  const maxStringChars = Math.max(200, Math.min(8000, toNumber(process.env.PROMPT_GUARD_MAX_STRING_CHARS, 2000)))
  const maxAggregateChars = Math.max(500, Math.min(100000, toNumber(process.env.PROMPT_GUARD_MAX_AGGREGATE_CHARS, 20000)))
  const blockScore = Math.max(1, Math.min(100, toNumber(process.env.PROMPT_GUARD_BLOCK_SCORE, 60)))
  const warnScore = Math.max(1, Math.min(100, toNumber(process.env.PROMPT_GUARD_WARN_SCORE, 25)))

  const strings = collectStrings(payload, maxNodes, maxStringChars)
  let text = strings.join('\n')
  if (text.length > maxAggregateChars) text = text.slice(0, maxAggregateChars)

  const findings: PromptGuardFinding[] = []
  let score = 0

  for (const rule of [...HIGH_RULES, ...MEDIUM_RULES]) {
    if (rule.regex.test(text)) {
      findings.push({ id: rule.id, level: rule.level, reason: rule.reason })
      score += rule.weight
    }
  }

  if (strings.length === 0) {
    return { enabled: true, level: 'allow', score: 0, findings: [], excerpt: '' }
  }

  if (strings.join('').length >= maxAggregateChars) {
    findings.push({
      id: 'payload_too_large_for_safe_prompt_processing',
      level: 'medium',
      reason: 'Payload too large for safe prompt processing',
    })
    score += 15
  }

  if (score > 100) score = 100
  const level: GuardLevel = score >= blockScore ? 'block' : score >= warnScore ? 'warn' : 'allow'

  return {
    enabled: true,
    level,
    score,
    findings,
    excerpt: text.slice(0, 300),
  }
}
