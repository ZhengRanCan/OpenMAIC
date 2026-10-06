import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const textKeys = new Set(['content', 'text', 'description', 'narration', 'instruction', 'label', 'question', 'answer', 'latex', 'title'])
const ignoredKeys = new Set(['html', 'url', 'src', 'data', 'mediaIndex', 'audio', 'video'])

function fail(message) { throw new Error(message) }

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch (error) { fail(`${path}: cannot parse JSON (${error.message})`) }
}

function cliOptions(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`${key} needs a value.`)
    result[key.slice(2)] = value
    index += 1
  }
  return result
}

function stripMarkup(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectText(value, key = '', output = [], depth = 0) {
  if (depth > 12 || ignoredKeys.has(key) || value === null || value === undefined) return output
  if (typeof value === 'string') {
    if (textKeys.has(key)) {
      const text = stripMarkup(value)
      if (text) output.push(text.slice(0, 1200))
    }
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, key, output, depth + 1)
    return output
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) collectText(childValue, childKey, output, depth + 1)
  }
  return output
}

function normaliseManifest(manifest) {
  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : []
  return {
    stage: {
      name: typeof manifest.stage?.name === 'string' ? manifest.stage.name : '',
      description: typeof manifest.stage?.description === 'string' ? manifest.stage.description : ''
    },
    topLevelFields: Object.keys(manifest),
    scenes: scenes.map((scene, index) => {
      const text = [...new Set([
        stripMarkup(scene?.title ?? ''),
        ...collectText(scene?.content),
        ...collectText(scene?.actions)
      ].filter(Boolean))]
      return {
        order: Number.isFinite(scene?.order) ? scene.order : index + 1,
        title: typeof scene?.title === 'string' ? scene.title : '',
        type: typeof scene?.type === 'string' ? scene.type : '',
        contentType: typeof scene?.content?.type === 'string' ? scene.content.type : '',
        text
      }
    })
  }
}

function sceneMatches(scene, term) {
  return scene.text.join('\n').toLocaleLowerCase('zh-CN').includes(String(term).toLocaleLowerCase('zh-CN'))
}

function evidenceFor(lesson, term) {
  return lesson.scenes
    .filter((scene) => sceneMatches(scene, term))
    .map((scene) => ({ order: scene.order, title: scene.title, term }))
}

function evaluateAutomatedRule(rule, lesson) {
  const automated = rule.automated
  if (!automated || typeof automated !== 'object') return { status: 'not_configured', checks: [], evidence: [] }
  const checks = []
  const evidence = []
  const allOf = Array.isArray(automated.allOf) ? automated.allOf : []
  const anyOf = Array.isArray(automated.anyOf) ? automated.anyOf : []
  const requiredTypes = Array.isArray(automated.contentTypes) ? automated.contentTypes : []
  const minimumScenes = Number.isInteger(automated.minScenes) ? automated.minScenes : 0

  for (const term of allOf) {
    const matches = evidenceFor(lesson, term)
    checks.push({ type: 'allOf', value: term, passed: matches.length > 0 })
    evidence.push(...matches)
  }
  if (anyOf.length) {
    const matches = anyOf.flatMap((term) => evidenceFor(lesson, term))
    checks.push({ type: 'anyOf', value: anyOf, passed: matches.length > 0 })
    evidence.push(...matches)
  }
  if (requiredTypes.length) {
    const matches = lesson.scenes.filter((scene) => requiredTypes.includes(scene.contentType) || requiredTypes.includes(scene.type))
    checks.push({ type: 'contentTypes', value: requiredTypes, passed: matches.length > 0 })
    evidence.push(...matches.map((scene) => ({ order: scene.order, title: scene.title, contentType: scene.contentType || scene.type })))
  }
  if (minimumScenes) {
    const matchedScenes = new Set(evidence.map((item) => item.order))
    checks.push({ type: 'minScenes', value: minimumScenes, actual: matchedScenes.size, passed: matchedScenes.size >= minimumScenes })
  }
  return {
    status: checks.every((check) => check.passed) ? 'passed' : 'failed',
    checks,
    evidence: dedupeEvidence(evidence)
  }
}

function dedupeEvidence(items) {
  const grouped = new Map()
  for (const item of items) {
    const key = `${item.order ?? ''}:${item.title ?? ''}:${item.contentType ?? ''}`
    const existing = grouped.get(key) ?? { ...item, terms: [] }
    if (item.term && !existing.terms.includes(item.term)) existing.terms.push(item.term)
    grouped.set(key, existing)
  }
  return [...grouped.values()]
}

function inspectManifestStandard(standard, rawManifest, lesson) {
  const requiredFields = Array.isArray(standard?.requiredFields) ? standard.requiredFields : []
  const requiredTypes = Array.isArray(standard?.requiredSceneContentTypes) ? standard.requiredSceneContentTypes : []
  const minimumScenes = Number.isInteger(standard?.minimumScenes) ? standard.minimumScenes : 0
  const checks = [
    ...requiredFields.map((field) => ({ type: 'requiredField', value: field, passed: Object.hasOwn(rawManifest, field) })),
    { type: 'minimumScenes', value: minimumScenes, actual: lesson.scenes.length, passed: lesson.scenes.length >= minimumScenes },
    ...requiredTypes.map((type) => ({
      type: 'requiredSceneContentType',
      value: type,
      passed: lesson.scenes.some((scene) => scene.contentType === type || scene.type === type)
    }))
  ]
  return { status: checks.every((check) => check.passed) ? 'passed' : 'failed', checks }
}

function resolveArtifactPath(specPath, manifestPath) {
  if (typeof manifestPath !== 'string' || !manifestPath) fail('Every artifact needs a manifest path.')
  return isAbsolute(manifestPath) ? manifestPath : resolve(rootDir, manifestPath)
}

function validateSpec(spec) {
  if (spec?.schemaVersion !== 1) fail('Only test declaration schemaVersion 1 is supported.')
  for (const key of ['testId', 'featureId']) if (typeof spec?.[key] !== 'string' || !spec[key]) fail(`Test declaration needs ${key}.`)
  if (!Array.isArray(spec.artifacts) || !spec.artifacts.length) fail('Test declaration needs artifacts.')
  if (!spec.manifestStandard || typeof spec.manifestStandard !== 'object') fail('Test declaration needs manifestStandard.')
  if (!Array.isArray(spec.sharedRequirements)) fail('Test declaration needs sharedRequirements.')
  if (!spec.groupRequirements || typeof spec.groupRequirements !== 'object') fail('Test declaration needs groupRequirements.')
}

function controlCheck(spec) {
  const fields = Array.isArray(spec.control?.mustMatch) ? spec.control.mustMatch : []
  const groups = Array.isArray(spec.control?.groups) ? spec.control.groups : []
  const applicable = spec.artifacts.filter((artifact) => groups.length === 0 || groups.includes(artifact.group))
  return fields.map((field) => {
    const values = applicable.map((artifact) => artifact.controlledInput?.[field])
    const unique = [...new Set(values)]
    const requiresSha256 = field.toLocaleLowerCase('en-US').endsWith('sha256')
    const validFingerprints = !requiresSha256 || values.every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value))
    return {
      field,
      groups,
      artifactIds: applicable.map((artifact) => artifact.id),
      passed: values.length > 0 && values.every(Boolean) && unique.length === 1 && validFingerprints,
      reason: validFingerprints ? undefined : `${field} must be a 64-character SHA-256 hex digest.`
    }
  })
}

function requirementsFor(spec, artifact) {
  return [
    ...spec.sharedRequirements.map((rule) => ({ scope: 'shared', ...rule })),
    ...(Array.isArray(spec.groupRequirements[artifact.group]) ? spec.groupRequirements[artifact.group] : []).map((rule) => ({ scope: artifact.group, ...rule }))
  ]
}

function markdownReport(report) {
  const lines = [
    `# ${report.testId} 审查报告`,
    '',
    `- Feature：${report.featureId}`,
    `- 生成时间：${report.generatedAt}`,
    `- 声明 SHA-256：\`${report.specSha256}\``,
    `- 说明：本报告不包含原始 Prompt、互动 HTML、音频或媒体索引；教学质量仍需人工/AI 审阅。`,
    '',
    '## 受控输入',
    '',
    '| 字段 | 测试组 | 结果 |',
    '| --- | --- | --- |',
    ...report.control.map((item) => `| ${item.field} | ${item.artifactIds.join(', ')} | ${item.passed ? '通过' : '失败'} |`),
    ...report.control.filter((item) => item.reason).map((item) => `\n> 注意：${item.reason}`),
    '',
    '## 课堂规则',
    ''
  ]
  for (const artifact of report.artifacts) {
    lines.push(`### ${artifact.id}（组 ${artifact.group}）`, '')
    lines.push(`Manifest 标准：${artifact.manifestStandard.status === 'passed' ? '通过' : '失败'}`, '')
    lines.push('| 范围 | 规则 | 结果 | 场景证据 |', '| --- | --- | --- | --- |')
    for (const result of artifact.requirements) {
      const evidence = result.automated.evidence.map((item) => `#${item.order} ${item.title}${item.terms?.length ? `（${item.terms.join('、')}）` : ''}`).join('；') || '无自动文本证据'
      const status = result.automated.status === 'passed' ? '通过' : result.automated.status === 'failed' ? '失败' : '需 AI/人工审阅'
      lines.push(`| ${result.scope} | ${result.requirement} | ${status} | ${evidence} |`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

function aiReviewMarkdown(report) {
  const lines = [
    `# ${report.testId} AI 审阅包`,
    '',
    '## 使用边界',
    '',
    '此包仅含课程名称、场景标题、内容类型、可读文本及规则证据。不得将 AI 的回答当作课程事实正确性、真实学习效果或自动放行结论。若课堂包含私人内容，提交给外部 AI 前必须获得授权并自行脱敏。',
    '',
    '## 审阅指令',
    '',
    '逐条回答下列问题。每项结论使用“符合 / 部分符合 / 不符合 / 无法判断”之一，并引用至少一个场景编号和标题；不要根据未提供的信息推断。',
    ''
  ]
  for (const artifact of report.artifacts) {
    lines.push(`## ${artifact.id}（组 ${artifact.group}）`, '')
    for (const result of artifact.requirements) {
      lines.push(`- **${result.scope} / ${result.id}**：${result.aiReview || result.requirement}`)
      const evidence = result.automated.evidence.map((item) => `#${item.order} ${item.title}${item.terms?.length ? `（${item.terms.join('、')}）` : ''}`).join('；') || '无自动证据，请仅依据场景摘要判断。'
      lines.push(`  - 自动证据：${evidence}`)
    }
    lines.push('', '### 场景摘要', '')
    for (const scene of artifact.lesson.scenes) {
      const excerpt = scene.text.join(' | ').slice(0, 700)
      lines.push(`- #${scene.order} [${scene.contentType || scene.type || 'unknown'}] ${scene.title}${excerpt ? `：${excerpt}` : ''}`)
    }
    lines.push('')
  }
  const baseline = report.artifacts.find((artifact) => artifact.group === 'baseline')
  const variants = report.artifacts.filter((artifact) => artifact !== baseline)
  if (baseline && variants.length) {
    lines.push('## 跨组比较', '')
    lines.push(`- 以 **${baseline.id}（baseline）** 为参照，分别比较 ${variants.map((artifact) => `**${artifact.id}（${artifact.group}）**`).join('、')}：每组输出在哪些场景、学习任务、支架深度或挑战程度上存在可引用的差异？`)
    lines.push('- 对每个差异判断它是否符合该组声明的差异化要求；若共同要求在某组缺失，也须指出。')
    lines.push('- 受控 Prompt 指纹一致只支持“Prompt 已控制”的测试前提；不得把单轮输出差异写成真实学习效果或排除模型随机性的证明。')
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

export function runAudit({ specPath, outputPath }) {
  const absoluteSpecPath = isAbsolute(specPath) ? specPath : resolve(rootDir, specPath)
  const spec = readJson(absoluteSpecPath)
  validateSpec(spec)
  const artifacts = spec.artifacts.map((artifact) => {
    if (typeof artifact?.id !== 'string' || typeof artifact?.group !== 'string') fail('Every artifact needs id and group.')
    const manifestPath = resolveArtifactPath(absoluteSpecPath, artifact.manifest)
    if (!existsSync(manifestPath)) fail(`${artifact.id}: manifest does not exist: ${artifact.manifest}`)
    const rawManifest = readJson(manifestPath)
    const lesson = normaliseManifest(rawManifest)
    return {
      id: artifact.id,
      group: artifact.group,
      manifest: artifact.manifest,
      controlledInput: artifact.controlledInput ?? {},
      manifestStandard: inspectManifestStandard(spec.manifestStandard, rawManifest, lesson),
      requirements: requirementsFor(spec, artifact).map((rule) => ({
        id: rule.id,
        scope: rule.scope,
        requirement: rule.requirement,
        aiReview: rule.aiReview,
        automated: evaluateAutomatedRule(rule, lesson)
      })),
      lesson
    }
  })
  const report = {
    reportVersion: 1,
    testId: spec.testId,
    featureId: spec.featureId,
    generatedAt: new Date().toISOString(),
    specSha256: createHash('sha256').update(JSON.stringify(spec)).digest('hex'),
    privacy: { originalPromptIncluded: false, interactiveHtmlIncluded: false, mediaIndexIncluded: false },
    control: controlCheck(spec),
    artifacts
  }
  const absoluteOutputPath = isAbsolute(outputPath) ? outputPath : resolve(rootDir, outputPath)
  mkdirSync(absoluteOutputPath, { recursive: true })
  writeFileSync(resolve(absoluteOutputPath, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(resolve(absoluteOutputPath, 'report.md'), markdownReport(report), 'utf8')
  writeFileSync(resolve(absoluteOutputPath, 'ai-review.md'), aiReviewMarkdown(report), 'utf8')
  return { report, outputPath: absoluteOutputPath }
}

function main() {
  const options = cliOptions(process.argv.slice(2))
  if (!options.spec || !options.output) fail('Usage: node scripts/classroom-manifest-audit.mjs --spec <test.json> --output <directory>')
  const { report, outputPath } = runAudit({ specPath: options.spec, outputPath: options.output })
  const failed = report.control.filter((item) => !item.passed).length + report.artifacts.flatMap((artifact) => [artifact.manifestStandard.status, ...artifact.requirements.map((item) => item.automated.status)]).filter((status) => status === 'failed').length
  console.log(`Classroom manifest audit: ${report.artifacts.length} artifacts, ${failed} automated failures.`)
  console.log(`Output: ${outputPath}`)
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
