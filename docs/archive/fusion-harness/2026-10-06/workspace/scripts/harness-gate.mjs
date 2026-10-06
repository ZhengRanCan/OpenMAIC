import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = resolve(rootDir, process.env.HARNESS_FEATURE_LIST ?? 'docs/harness/features/feature-index.json')
const progressPath = resolve(rootDir, process.env.HARNESS_PROGRESS_PATH ?? 'docs/progress.md')
const statuses = new Set(['not_started', 'active', 'blocked', 'passing'])
const progressHeadings = ['当前 feature', '暂停 feature', '已完成', '当前边界与风险', '下一步']
// F01/F02 were completed before the Git evidence gate existed. New features
// cannot opt out; their code changes must be committed and pushed before
// `passing` is allowed.
const legacyGitEvidenceExemptions = new Set(['F01', 'F02'])
const errors = []

function fail(message) { errors.push(message) }
function parseValue(value) {
  try { return JSON.parse(value) } catch { return value.replace(/^['"]|['"]$/g, '') }
}
function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  return Object.fromEntries(match[1].split('\n').flatMap((line) => {
    const i = line.indexOf(':')
    return i < 1 ? [] : [[line.slice(0, i).trim(), parseValue(line.slice(i + 1).trim())]]
  }))
}
function array(value) { return Array.isArray(value) ? value : [] }
function commandPassed(evidence) { return array(evidence?.commands).some((entry) => entry?.result === 'passed') }
function progressSection(markdown, heading) {
  const match = markdown.match(new RegExp('^## ' + heading + '[ \\t]*\\r?$', 'm'))
  if (!match || match.index === undefined) return null
  const start = match.index + match[0].length
  const next = markdown.slice(start).search(/\\r?\\n## /)
  return markdown.slice(start, next < 0 ? undefined : start + next)
}
function progressEntries(section, status) {
  if (section === null) return []
  const codeTick = String.fromCharCode(96)
  const pattern = new RegExp('^\\s*-\\s*(F\\d+)\\s+—.*?' + codeTick + status + codeTick + '.*$', 'gm')
  return [...section.matchAll(pattern)].map((match) => match[1])
}
function sameIds(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length && actual.every((id) => expected.includes(id))
}
function validateProgress(indexEntries) {
  let markdown
  try { markdown = readFileSync(progressPath, 'utf8') }
  catch (error) { fail('Cannot read progress.md: ' + error.message); return }

  const sections = new Map()
  for (const heading of progressHeadings) {
    const count = [...markdown.matchAll(new RegExp('^## ' + heading + '[ \\t]*\\r?$', 'gm'))].length
    if (count !== 1) fail('progress.md: required heading "' + heading + '" must appear exactly once.')
    sections.set(heading, progressSection(markdown, heading))
  }

  const activeExpected = indexEntries.filter((entry) => entry?.status === 'active').map((entry) => entry.id)
  const blockedExpected = indexEntries.filter((entry) => entry?.status === 'blocked').map((entry) => entry.id)
  const activeActual = progressEntries(sections.get('当前 feature'), 'active')
  const blockedActual = progressEntries(sections.get('暂停 feature'), 'blocked')
  const allActive = progressEntries(markdown, 'active')
  const allBlocked = progressEntries(markdown, 'blocked')

  if (!sameIds(activeActual, activeExpected) || !sameIds(allActive, activeExpected)) {
    fail('progress.md: current active Feature entries must exactly match feature-index.json (' + (activeExpected.join(', ') || 'none') + ').')
  }
  if (activeExpected.length === 0 && !/^\s*-\s*无 active feature。?\s*$/m.test(sections.get('当前 feature') ?? '')) {
    fail('progress.md: current feature section must state "无 active feature。" when the registry has no active Feature.')
  }
  if (!sameIds(blockedActual, blockedExpected) || !sameIds(allBlocked, blockedExpected)) {
    fail('progress.md: paused blocked Feature entries must exactly match feature-index.json (' + (blockedExpected.join(', ') || 'none') + ').')
  }
}
function changesForkCode(feature) {
  return array(feature.scope?.code).some((path) => typeof path === 'string' && /^(DeepTutor|OpenMAIC)[\\/]/.test(path))
}
function acceptance(markdown) {
  const heading = markdown.match(/^## (?:Acceptance Criteria|验收标准)[ \t]*\r?$/m)
  if (!heading || heading.index === undefined) return []
  const start = heading.index + heading[0].length
  const nextHeading = markdown.slice(start).search(/\r?\n## /)
  const section = markdown.slice(start, nextHeading < 0 ? undefined : start + nextHeading)
  return [...section.matchAll(/^[-*]\s+\[([ xX])\]\s+.+$/gm)].map((match) => match[1].toLowerCase() === 'x')
}
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}
function validateGitEvidence(feature) {
  const label = feature.id
  const evidence = feature.completionGate?.gitEvidence
  if (legacyGitEvidenceExemptions.has(label) && evidence?.legacyExempt === true) return
  if (!evidence || typeof evidence !== 'object') {
    fail(`${label}: passing feature needs completionGate.gitEvidence.`)
    return
  }
  const repositories = array(evidence.repositories)
  if (!repositories.length) {
    fail(`${label}: gitEvidence.repositories must list every changed Fork.`)
    return
  }
  for (const repository of repositories) {
    const path = repository?.path
    const branch = repository?.branch
    const commit = repository?.commit
    if (typeof path !== 'string' || typeof branch !== 'string' || typeof commit !== 'string') {
      fail(`${label}: every git evidence entry needs path, branch and commit.`)
      continue
    }
    const cwd = resolve(rootDir, path)
    if (!existsSync(cwd)) { fail(`${label}: Git evidence path does not exist: ${path}.`); continue }
    const currentBranch = git(['branch', '--show-current'], cwd)
    if (!currentBranch.ok || currentBranch.output !== branch) {
      fail(`${label}: ${path} must be on ${branch} before passing.`)
      continue
    }
    if (!git(['cat-file', '-e', `${commit}^{commit}`], cwd).ok) {
      fail(`${label}: ${path} commit ${commit} does not exist.`)
      continue
    }
    if (!git(['merge-base', '--is-ancestor', commit, 'HEAD'], cwd).ok) {
      fail(`${label}: ${path} HEAD does not contain recorded commit ${commit}.`)
    }
    if (!git(['merge-base', '--is-ancestor', commit, `origin/${branch}`], cwd).ok) {
      fail(`${label}: origin/${branch} does not contain recorded commit ${commit}; push it before passing.`)
    }
    const status = git(['status', '--porcelain'], cwd)
    if (!status.ok || status.output) fail(`${label}: ${path} worktree must be clean before passing.`)
  }
}
function loadFeature(entry) {
  const label = entry?.id ?? 'unknown'
  for (const key of ['id', 'title', 'status', 'feature_folder', 'version']) {
    if (typeof entry?.[key] !== 'string' || entry[key].length === 0) fail(`${label}: index entry needs ${key}.`)
  }
  if (!statuses.has(entry?.status)) fail(`${label}: invalid status "${entry?.status}".`)
  const folder = resolve(rootDir, entry.feature_folder ?? '')
  const file = resolve(folder, 'feature.md')
  if (!existsSync(file)) { fail(`${label}: missing feature.md.`); return null }
  const verification = resolve(folder, 'verification.md')
  if (!existsSync(verification)) fail(`${label}: missing verification.md.`)
  const markdown = readFileSync(file, 'utf8')
  const feature = { ...entry, ...frontmatter(markdown), acceptance: acceptance(markdown) }
  if (feature.id !== entry.id) fail(`${label}: contract id does not match index.`)
  if (feature.status !== entry.status) fail(`${label}: contract status does not match index.`)
  return feature
}
function validate(feature, all) {
  if (!feature) return
  const label = feature.id
  if (!array(feature.dependsOn)) fail(`${label}: dependsOn must be an array.`)
  if (!feature.scope || typeof feature.scope !== 'object') fail(`${label}: scope must be an object.`)
  if (!feature.evidence || typeof feature.evidence !== 'object') fail(`${label}: evidence must be an object.`)
  const gate = feature.completionGate
  if (!gate || typeof gate !== 'object') { fail(`${label}: completionGate must be an object.`); return }
  for (const key of ['userPath', 'integrationEvidence', 'knownUnverified', 'humanReviewRequired']) {
    if (!array(gate[key])) fail(`${label}: completionGate.${key} must be an array.`)
  }
  if (!['required', 'not_required'].includes(gate.l3)) fail(`${label}: completionGate.l3 is invalid.`)
  for (const dependency of array(feature.dependsOn)) {
    const parent = all.find((item) => item?.id === dependency)
    if (!parent) fail(`${label}: missing dependency ${dependency}.`)
    else if (['active', 'passing'].includes(feature.status) && parent.status !== 'passing') fail(`${label}: dependency ${dependency} must be passing.`)
  }
  if (feature.status !== 'passing') return
  if (!feature.evidence?.lastVerifiedAt) fail(`${label}: passing feature needs evidence.lastVerifiedAt.`)
  if (!commandPassed(feature.evidence)) fail(`${label}: passing feature needs a passed command.`)
  if (!feature.acceptance.length) fail(`${label}: passing feature needs acceptance criteria.`)
  if (feature.acceptance.some((checked) => !checked)) fail(`${label}: all acceptance criteria must be checked before passing.`)
  if (array(gate.knownUnverified).length) fail(`${label}: passing feature cannot have knownUnverified items.`)
  if (array(gate.humanReviewRequired).length) fail(`${label}: passing feature cannot have pending human review.`)
  if (gate.l3 === 'required' && !array(gate.integrationEvidence).length && !String(feature.evidence?.manualSmoke ?? '').trim()) fail(`${label}: L3 requires integration or manual-path evidence.`)
  if (changesForkCode(feature)) validateGitEvidence(feature)
}

function validateArchitectureSplit() {
  const script = resolve(rootDir, 'scripts/architecture-split.mjs')
  if (!existsSync(script)) { fail('Architecture split script is missing: scripts/architecture-split.mjs.'); return }
  const result = spawnSync(process.execPath, [script, 'check'], { cwd: rootDir, encoding: 'utf8' })
  if (result.status !== 0) fail(`Architecture split is out of sync: ${(result.stderr || result.stdout || '').trim()}`)
}

let entries = []
try {
  entries = JSON.parse(readFileSync(indexPath, 'utf8'))
  if (!Array.isArray(entries)) fail('feature-index.json must be an array.')
} catch (error) { fail(`Cannot read feature index: ${error.message}`) }
const features = Array.isArray(entries) ? entries.map(loadFeature) : []
if (features.filter((feature) => feature?.status === 'active').length > 1) fail('Only one active feature is allowed.')
if (Array.isArray(entries)) validateProgress(entries)
validateArchitectureSplit()
const ids = new Set()
for (const feature of features) {
  if (feature && ids.has(feature.id)) fail(`${feature.id}: duplicate feature id.`)
  if (feature) ids.add(feature.id)
}
for (const feature of features) validate(feature, features)
console.log(`Harness gate: ${features.filter(Boolean).length} features, ${errors.length} errors.`)
for (const error of errors) console.error(`- ${error}`)
if (errors.length) process.exit(1)
