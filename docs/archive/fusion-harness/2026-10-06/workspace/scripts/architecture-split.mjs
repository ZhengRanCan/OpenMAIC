import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const canonicalPath = resolve(rootDir, 'docs/harness/ARCHITECTURE.md')
const splitDir = resolve(rootDir, 'docs/harness/ARCHITECTURE/F35_ARCHITECTURE_SPLIT')
const bodyMarker = '<!-- ARCHITECTURE-SPLIT: body-start -->'

const fragments = [
  {
    file: '01-system-responsibilities-and-domain-ownership.md',
    title: 'Architecture — 系统职责与领域所有权',
    summary: '定义 DeepTutor、OpenMAIC、Fusion Adapter 与 Browser 的权威职责。',
    range: [1, 1],
    anchors: [
      'Adapter 分层与信任边界：[02-fusion-adapter-layering-and-trust-boundaries.md](02-fusion-adapter-layering-and-trust-boundaries.md)。',
      '身份与权威状态：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。',
      '核心对象与阶段交接：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。',
    ],
  },
  {
    file: '02-fusion-adapter-layering-and-trust-boundaries.md',
    title: 'Architecture — Fusion Adapter 分层与信任边界',
    summary: '定义 Adapter 逻辑分层、依赖方向、ACL 和跨域信任边界。',
    range: [2, 2],
    anchors: [
      '系统职责与领域所有权：[01-system-responsibilities-and-domain-ownership.md](01-system-responsibilities-and-domain-ownership.md)。',
      '身份与权威状态：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。',
      '完整性、可靠性与安全：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。',
    ],
  },
  {
    file: '03-identity-lesson-binding-and-authoritative-state.md',
    title: 'Architecture — 身份、Lesson Binding 与权威状态',
    summary: '定义 Launch 身份链、持久 Lesson Binding、用户作用域和权威状态。',
    range: [3, 3],
    anchors: [
      '系统职责：[01-system-responsibilities-and-domain-ownership.md](01-system-responsibilities-and-domain-ownership.md)。',
      '阶段对象与交接：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。',
      'DeepTutor 画像处理边界：[06-deeptutor-profile-processing-boundary.md](06-deeptutor-profile-processing-boundary.md)。',
    ],
  },
  {
    file: '04-core-domain-objects-and-stage-handoffs.md',
    title: 'Architecture — 核心领域对象与阶段交接',
    summary: '定义全局核心领域对象、所有权、共同关联和阶段交接。',
    range: [4, 4],
    anchors: [
      '身份与权威状态：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。',
      '三阶段主链路：[05-pre-in-post-class-main-flow.md](05-pre-in-post-class-main-flow.md)。',
      '完整性规范：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。',
    ],
  },
  {
    file: '05-pre-in-post-class-main-flow.md',
    title: 'Architecture — 课前 → 课中 → 课后主链路',
    summary: '定义从课前冻结上下文到课中可信事实和课后 Candidate 的主链路。',
    range: [5, 5],
    anchors: [
      '核心对象与阶段交接：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。',
      'DeepTutor 画像处理：[06-deeptutor-profile-processing-boundary.md](06-deeptutor-profile-processing-boundary.md)。',
      '完整性与生命周期：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。',
    ],
  },
  {
    file: '06-deeptutor-profile-processing-boundary.md',
    title: 'Architecture — DeepTutor 画像处理边界',
    summary: '定义 Candidate、Fusion Fact、Mastery、Agent Proposal 与 Memory 的处理边界。',
    range: [6, 6],
    anchors: [
      '身份与用户作用域：[03-identity-lesson-binding-and-authoritative-state.md](03-identity-lesson-binding-and-authoritative-state.md)。',
      '三阶段主链路：[05-pre-in-post-class-main-flow.md](05-pre-in-post-class-main-flow.md)。',
      '完整性与生命周期：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。',
    ],
  },
  {
    file: '07-integrity-reliability-security-and-lifecycle.md',
    title: 'Architecture — 完整性、可靠性、安全与生命周期',
    summary: '定义 canonical digest、可靠投递、安全最小化、删除和审计边界。',
    range: [7, 7],
    anchors: [
      'Adapter 信任边界：[02-fusion-adapter-layering-and-trust-boundaries.md](02-fusion-adapter-layering-and-trust-boundaries.md)。',
      '核心对象与关联：[04-core-domain-objects-and-stage-handoffs.md](04-core-domain-objects-and-stage-handoffs.md)。',
      '实现成熟度：[08-implementation-maturity-and-migration-status.md](08-implementation-maturity-and-migration-status.md)。',
    ],
  },
  {
    file: '08-implementation-maturity-and-migration-status.md',
    title: 'Architecture — 实现成熟度与迁移状态',
    summary: '区分全局架构、详细设计、已审核迁移参考、provisional 设计和实现证据。',
    range: [8, 8],
    anchors: [
      '三阶段主链路：[05-pre-in-post-class-main-flow.md](05-pre-in-post-class-main-flow.md)。',
      '完整性与可靠性：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。',
      '待决事项：[09-open-decisions.md](09-open-decisions.md)。',
    ],
  },
  {
    file: '09-open-decisions.md',
    title: 'Architecture — 待决事项',
    summary: '集中记录尚未定稿的产品、协议、身份、存储、迁移和生命周期问题。',
    range: [9, 9],
    anchors: [
      '系统职责：[01-system-responsibilities-and-domain-ownership.md](01-system-responsibilities-and-domain-ownership.md)。',
      '完整性与生命周期：[07-integrity-reliability-security-and-lifecycle.md](07-integrity-reliability-security-and-lifecycle.md)。',
      '实现成熟度：[08-implementation-maturity-and-migration-status.md](08-implementation-maturity-and-migration-status.md)。',
    ],
  },
]

function fail(message) {
  console.error(`Architecture split: ${message}`)
  process.exit(1)
}

function read(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`)
  }
}

function sections(markdown) {
  const matches = [...markdown.matchAll(/^## (\d+)\. .+$/gm)]
  if (!matches.length) fail('canonical document has no numbered H2 sections.')
  const result = new Map()
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const number = Number(match[1])
    const start = match.index
    const end = index + 1 < matches.length ? matches[index + 1].index : markdown.length
    result.set(number, markdown.slice(start, end).trim())
  }
  return result
}

function preamble(markdown) {
  const firstSection = markdown.search(/^## \d+\. .+$/m)
  if (firstSection < 0) fail('canonical document has no numbered H2 sections.')
  return markdown.slice(0, firstSection).trim()
}

function canonicalBodies(markdown) {
  const allSections = sections(markdown)
  return fragments.map((fragment) => {
    const [from, to] = fragment.range
    const body = []
    for (let section = from; section <= to; section += 1) {
      const sectionText = allSections.get(section)
      if (!sectionText) fail(`canonical document is missing section ${section} for ${fragment.file}.`)
      body.push(sectionText)
    }
    return body.join('\n\n')
  })
}

function render(fragment, body) {
  const anchors = fragment.anchors.map((anchor) => `> - ${anchor}`).join('\n')
  return `# ${fragment.title}\n\n> ${fragment.summary}\n\n> 💡 **上下文锚点**：\n>\n${anchors}\n\n${bodyMarker}\n\n${body.trim()}\n`
}

function fragmentBody(fragment) {
  const markdown = read(resolve(splitDir, fragment.file))
  const markerIndex = markdown.indexOf(bodyMarker)
  if (markerIndex >= 0) return markdown.slice(markerIndex + bodyMarker.length).trim()
  const legacyBody = markdown.match(/^## \d+\. .+$/m)
  if (!legacyBody || legacyBody.index === undefined) {
    fail(`${fragment.file} has no generated body marker or numbered H2 body.`)
  }
  return markdown.slice(legacyBody.index).trim()
}

function validateFragmentBody(fragment, body) {
  const found = [...body.matchAll(/^## (\d+)\. .+$/gm)].map((match) => Number(match[1]))
  const [from, to] = fragment.range
  const expected = Array.from({ length: to - from + 1 }, (_, offset) => from + offset)
  if (found.length !== expected.length || found.some((number, index) => number !== expected[index])) {
    fail(`${fragment.file} must contain only sections ${from}–${to}; found ${found.join(', ') || 'none'}.`)
  }
}

function split() {
  const bodies = canonicalBodies(read(canonicalPath))
  fragments.forEach((fragment, index) => {
    writeFileSync(resolve(splitDir, fragment.file), render(fragment, bodies[index]), 'utf8')
  })
  console.log(`Architecture split: wrote ${fragments.length} generated fragments from docs/harness/ARCHITECTURE.md.`)
}

function merge() {
  const bodies = fragments.map((fragment) => {
    const body = fragmentBody(fragment)
    validateFragmentBody(fragment, body)
    return body
  })
  writeFileSync(canonicalPath, `${preamble(read(canonicalPath))}\n\n${bodies.join('\n\n')}\n`, 'utf8')
  console.log(`Architecture split: merged ${fragments.length} fragments into docs/harness/ARCHITECTURE.md.`)
}

function check() {
  const bodies = canonicalBodies(read(canonicalPath))
  const drifted = fragments.filter((fragment, index) => {
    return read(resolve(splitDir, fragment.file)) !== render(fragment, bodies[index])
  })
  if (drifted.length) {
    fail(`generated fragments differ from canonical: ${drifted.map((fragment) => fragment.file).join(', ')}. Run "node scripts/architecture-split.mjs split".`)
  }
  console.log(`Architecture split: ${fragments.length} fragments match the canonical document.`)
}

const command = process.argv[2]
if (command === 'split') split()
else if (command === 'merge') merge()
else if (command === 'check') check()
else fail('usage: node scripts/architecture-split.mjs <split|merge|check>')
