import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from './helpers/ai-source-files'

// Keeps contributor and agent docs navigable after archiving or compaction:
// every relative Markdown link must resolve, every #anchor must match a
// GitHub heading slug, and source comments citing `docs/<file>.md#<anchor>`
// must still reach a heading. Walks fixed roots only, because other tests
// create scratch directories at the repository root.

const MARKDOWN_ROOTS = ['AGENTS.md', 'README.md', '.github', 'docs', 'public']
const SOURCE_ROOTS = ['index.html', 'scripts', 'src', '.github/workflows']
const SOURCE_FILE = /\.(?:html|m?js|ts|ya?ml)$/
const DOC_CITATION = /\b((?:docs|public)\/[\w./-]+\.md)(?:#([\w-]+))?/g
// Link titles use "…", '…' or (…). As in CommonMark, the parts of an inline
// link may be separated by spaces or tabs and at most one line break.
const TITLE = String.raw`(?:"[^"]*"|'[^']*'|\([^)]*\))`
const GAP = String.raw`[ \t]*(?:\n[ \t]*)?`
// Captures the text before the destination, to find its line, then the
// destination itself.
const MARKDOWN_LINK = new RegExp(String.raw`(\]\(${GAP}<?)([^)\s>]+)>?(?:(?=[ \t\n])${GAP}${TITLE})?${GAP}\)`, 'g')
// `[label]: target "title"` definitions, which every `[text][label]` or
// `[label]` use resolves through. `[^note]:` footnotes are not links.
const REFERENCE_DEFINITION = new RegExp(String.raw`^ {0,3}\[(?!\^)[^\]]+\]:\s*<?([^\s>]+)>?(?:\s+${TITLE})?\s*$`)

function walk(path: string, files: string[] = []): string[] {
  if (!existsSync(path)) return files
  if (!statSync(path).isDirectory()) {
    files.push(path)
    return files
  }
  for (const entry of readdirSync(path)) {
    if (entry !== 'node_modules') walk(join(path, entry), files)
  }
  return files
}

function filesUnder(roots: readonly string[], keep: (path: string) => boolean): string[] {
  return roots.flatMap((root) => walk(join(REPO_ROOT, root))).filter(keep)
}

// Lines with fenced code blanked, so line numbers stay accurate. As in
// CommonMark, only a bare run of the opening character that is at least as
// long closes a fence, so a ```` block can show ``` examples.
function proseLines(text: string): string[] {
  let fence = ''
  return text.split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (!fence) {
      if (!marker) return line
      fence = marker[1]
    } else if (marker && marker[1].startsWith(fence) && !marker[2].trim()) {
      fence = ''
    }
    return ''
  })
}

const anchorCache = new Map<string, Set<string>>()

/** Drops inline HTML tags, repeating until none is left (as GitHub's slugs use the text only). */
function withoutTags(text: string): string {
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^<>]*>/g, '')
  } while (text !== previous)
  return text
}

// Repeated heading slugs take the next unused -N suffix, as on GitHub
// (github-slugger): Foo, Foo-1, Foo gives foo, foo-1, foo-2. Explicit
// <a id|name> anchors don't affect the numbering.
function anchorsIn(text: string): Set<string> {
  const anchors = new Set<string>()
  const suffixes = new Map<string, number>()
  for (const line of proseLines(text)) {
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1])
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
    if (!heading) continue
    const base = withoutTags(heading[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-')
    let suffix = suffixes.get(base) ?? 0
    let slug = base
    while (suffixes.has(slug)) slug = `${base}-${++suffix}`
    suffixes.set(base, suffix)
    suffixes.set(slug, 0)
    anchors.add(slug)
  }
  return anchors
}

function anchorsOf(file: string): Set<string> {
  let anchors = anchorCache.get(file)
  if (!anchors) {
    anchors = anchorsIn(readFileSync(file, 'utf8'))
    anchorCache.set(file, anchors)
  }
  return anchors
}

function anchorProblem(anchors: Set<string>, anchor: string | undefined): string | null {
  return anchor && !anchors.has(anchor) ? `missing anchor #${anchor}` : null
}

function problemFor(target: string, anchor: string | undefined): string | null {
  if (!existsSync(target)) return 'missing file'
  return target.endsWith('.md') ? anchorProblem(anchorsOf(target), anchor) : null
}

function where(file: string, index: number): string {
  return `${file.slice(REPO_ROOT.length + 1)}:${index + 1}`
}

/** Percent-decodes a link part, keeping a malformed escape as written. */
function decoded(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function linkProblems(file: string, text: string): { checked: number; problems: string[] } {
  const result = { checked: 0, problems: [] as string[] }
  const lines = proseLines(text).map((line) => line.replace(/`[^`]*`/g, ''))
  const prose = lines.join('\n')
  // [line index, link]. Inline links may wrap, so they're matched across lines.
  const links: [number, string][] = [...prose.matchAll(MARKDOWN_LINK)].map((match) => [
    prose.slice(0, match.index + match[1].length).split('\n').length - 1,
    match[2],
  ])
  lines.forEach((line, index) => {
    const definition = REFERENCE_DEFINITION.exec(line)
    if (definition) links.push([index, definition[1]])
  })
  links.sort(([a], [b]) => a - b)
  const ownAnchors = anchorsIn(text)
  for (const [index, link] of links) {
    if (/^[a-z][a-z\d+.-]*:/i.test(link)) continue
    const [path, anchor] = link.split('#').map(decoded)
    result.checked += 1
    const problem = path ? problemFor(resolve(file, '..', path), anchor) : anchorProblem(ownAnchors, anchor)
    if (problem) result.problems.push(`${where(file, index)} ${link}: ${problem}`)
  }
  return result
}

describe('documentation links', () => {
  it('resolves relative Markdown links and heading anchors', () => {
    const problems: string[] = []
    let checked = 0
    for (const file of filesUnder(MARKDOWN_ROOTS, (path) => path.endsWith('.md'))) {
      const result = linkProblems(file, readFileSync(file, 'utf8'))
      checked += result.checked
      problems.push(...result.problems)
    }
    // Archiving shrinks the count, so only guard against a walk or pattern
    // that silently matches nothing.
    expect(checked).toBeGreaterThan(0)
    expect(problems).toEqual([])
  })

  it('resolves docs cited from source comments', () => {
    const problems: string[] = []
    for (const file of filesUnder(SOURCE_ROOTS, (path) => SOURCE_FILE.test(path))) {
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        for (const [citation, path, anchor] of line.matchAll(DOC_CITATION)) {
          const problem = problemFor(join(REPO_ROOT, path), anchor)
          if (problem) problems.push(`${where(file, index)} ${citation}: ${problem}`)
        }
      })
    }
    expect(problems).toEqual([])
  })

  it('keeps nested fence examples out of prose', () => {
    const fenced = ['````md', '```', '[x](missing-example.md)', '```', '````', '~~~', '```', '~~~']
    expect(proseLines([...fenced, 'after'].join('\n')).filter(Boolean)).toEqual(['after'])
  })

  it('checks reference-style link definitions', () => {
    const text = [
      'See [the guide][guide], [the rules] and a note.[^note]',
      '',
      '[guide]: missing.md',
      '[the rules]: ../AGENTS.md#no-such-rule "Rules"',
      '[^note]: Footnote.',
    ].join('\n')
    expect(linkProblems(join(REPO_ROOT, 'notes', 'example.md'), text)).toEqual({
      checked: 2,
      problems: [
        'notes/example.md:3 missing.md: missing file',
        'notes/example.md:4 ../AGENTS.md#no-such-rule: missing anchor #no-such-rule',
      ],
    })
  })

  it('checks link titles, wrapped destinations and encoded fragments', () => {
    const text = [
      '# Doppelgänger',
      '',
      "See [a](missing.md 'Title'), [b](missing.md (Title)), [c](",
      '  missing.md',
      ') and [d](',
      '#no-such-heading "Title"',
      '). [e](#doppelg%C3%A4nger) resolves.',
    ].join('\n')
    expect(linkProblems(join(REPO_ROOT, 'notes', 'example.md'), text)).toEqual({
      checked: 5,
      problems: [
        'notes/example.md:3 missing.md: missing file',
        'notes/example.md:3 missing.md: missing file',
        'notes/example.md:4 missing.md: missing file',
        'notes/example.md:6 #no-such-heading: missing anchor #no-such-heading',
      ],
    })
  })

  it('numbers repeated heading slugs like GitHub', () => {
    // Expected slugs come from GitHub's Markdown API.
    expect([...anchorsIn('# Foo\n# Foo-1\n# Foo')]).toEqual(['foo', 'foo-1', 'foo-2'])
    expect([...anchorsIn('# Foo\n# Foo\n# Foo-1')]).toEqual(['foo', 'foo-1', 'foo-1-1'])
  })
})
