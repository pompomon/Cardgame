import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from './helpers/ai-source-files'

// Keeps contributor and agent docs navigable after archiving or compaction:
// every relative Markdown link must resolve, every #anchor must match a
// GitHub heading slug, and source comments citing `docs/<file>.md#<anchor>`
// must still reach a heading. Walks fixed roots only, because other tests
// create scratch directories at the repository root. The Markdown parsing
// covers what these docs use, not all of CommonMark: entities, `_emphasis_`
// and backslash escapes in headings, list-item indentation, and the insides
// of block quotes and HTML blocks are out of scope.

const MARKDOWN_ROOTS = ['AGENTS.md', 'README.md', '.github', 'docs', 'public']
const SOURCE_ROOTS = ['index.html', 'scripts', 'src', '.github/workflows']
const SOURCE_FILE = /\.(?:html|m?js|ts|ya?ml)$/
const DOC_CITATION = /\b((?:docs|public)\/[\w./-]+\.md)(?:#([\w-]+))?/g
// Link titles use "…", '…' or (…). As in CommonMark, the parts of an inline
// link may be separated by spaces or tabs and at most one line break.
const TITLE = String.raw`(?:"[^"]*"|'[^']*'|\([^)]*\))`
const GAP = String.raw`[ \t]*(?:\n[ \t]*)?`
// A destination is <…>, captured without the brackets, or a bare run that
// may hold balanced parentheses one level deep: guide(copy).md.
const DESTINATION = String.raw`<([^<>\n]*)>|(?!<)((?:[^\s()]|\([^\s()]*\))+)`
// Captures the text before the destination, to find its line, then the
// destination itself.
const MARKDOWN_LINK = new RegExp(String.raw`(\]\(${GAP})(?:${DESTINATION})(?:(?=[ \t\n])${GAP}${TITLE})?${GAP}\)`, 'g')
// `[label]: target "title"` definitions, which every `[text][label]` or
// `[label]` use resolves through. `[^note]:` footnotes are not links.
const REFERENCE_DEFINITION = new RegExp(String.raw`^ {0,3}\[(?!\^)[^\]]+\]:\s*(?:${DESTINATION})(?:\s+${TITLE})?\s*$`)
// Fences and headings are indented at most three spaces; a deeper line is
// indented code. A backtick fence's info string holds no backticks.
const FENCE = /^ {0,3}(?:(`{3,})([^`]*)|(~{3,})(.*))$/
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
// A block quote, table row, HTML block, list item or thematic break, none of
// which continues a paragraph that a Setext underline could turn into a
// heading.
const BLOCK_START = /^ {0,3}(?:[>|<]|[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/

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

// Lines with fenced code and YAML front matter blanked, so line numbers stay
// accurate. As in CommonMark, only a bare run of the opening character that
// is at least as long closes a fence, so a ```` block can show ``` examples.
function proseLines(text: string): string[] {
  const lines = text.split('\n')
  const frontMatterEnd = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  let fence = ''
  return lines.map((line, index) => {
    if (index <= frontMatterEnd) return ''
    const marker = FENCE.exec(line)
    const run = marker?.[1] ?? marker?.[3] ?? ''
    if (!fence) {
      if (!run) return line
      fence = run
    } else if (run.startsWith(fence) && !(marker?.[2] ?? marker?.[4] ?? '').trim()) {
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

// GitHub keeps alphabetic characters, marks, decimal digits, connector
// punctuation, joiners, spaces and hyphens, then turns each space into a
// hyphen.
function slugBase(heading: string): string {
  return withoutTags(heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
    .toLowerCase()
    .replace(/[^\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control} -]/gu, '')
    .replace(/ /g, '-')
}

// Repeated heading slugs take the next unused -N suffix, as on GitHub
// (github-slugger): Foo, Foo-1, Foo gives foo, foo-1, foo-2. Explicit
// <a id|name> anchors don't affect the numbering.
function anchorsIn(text: string): Set<string> {
  const anchors = new Set<string>()
  const suffixes = new Map<string, number>()
  const addHeading = (heading: string) => {
    const base = slugBase(heading)
    let suffix = suffixes.get(base) ?? 0
    let slug = base
    while (suffixes.has(slug)) slug = `${base}-${++suffix}`
    suffixes.set(base, suffix)
    suffixes.set(slug, 0)
    anchors.add(slug)
  }
  // The lines a Setext underline would turn into a heading.
  let paragraph: string[] = []
  for (const line of proseLines(text)) {
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1])
    const atx = ATX_HEADING.exec(line)
    if (paragraph.length && SETEXT_UNDERLINE.test(line)) {
      addHeading(paragraph.join('\n'))
      paragraph = []
    } else if (atx) {
      addHeading(atx[1])
      paragraph = []
    } else if (!line.trim() || BLOCK_START.test(line)) {
      paragraph = []
    } else if (paragraph.length || /^ {0,3}\S/.test(line)) {
      // A deeper indent continues a paragraph but can't start one: it's code.
      paragraph.push(line.trim())
    }
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
    match[2] ?? match[3],
  ])
  lines.forEach((line, index) => {
    const definition = REFERENCE_DEFINITION.exec(line)
    if (definition) links.push([index, definition[1] ?? definition[2]])
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

  it('blanks front matter and treats only fences indented up to three spaces as code', () => {
    // Four spaces make indented code, which neither opens nor closes a fence.
    const text = ['---', 'applyTo: "src/**"', '---', '    ```', '', '[a](missing.md)', '   ~~~', '[b](missing.md)', '    ~~~', '~~~', 'after']
    expect(proseLines(text.join('\n'))).toEqual(['', '', '', '    ```', '', '[a](missing.md)', '', '', '', '', 'after'])
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

  it('reads angle-bracket and parenthesized destinations', () => {
    const text = [
      'See [a](<missing copy.md>), [b](guide(copy).md), [c](<guide(copy).md> "Title")',
      'and [d](missing.md (Title)).',
      '',
      '[e]: <missing copy.md> "Title"',
      '[f]: guide(copy).md',
    ].join('\n')
    expect(linkProblems(join(REPO_ROOT, 'notes', 'example.md'), text)).toEqual({
      checked: 6,
      problems: [
        'notes/example.md:1 missing copy.md: missing file',
        'notes/example.md:1 guide(copy).md: missing file',
        'notes/example.md:1 guide(copy).md: missing file',
        'notes/example.md:2 missing.md: missing file',
        'notes/example.md:4 missing copy.md: missing file',
        'notes/example.md:5 guide(copy).md: missing file',
      ],
    })
  })

  it('finds Setext and indented headings and slugs them like GitHub', () => {
    // Expected slugs come from GitHub's Markdown API in README mode.
    const text = [
      'Guide',
      '=====',
      '',
      '   ## Indented',
      '    # Indented code',
      '---',
      '',
      '    code',
      'Lazy',
      '    continuation',
      '===',
      '',
      'Two words',
      'heading',
      '---',
      '',
      '- item',
      '---',
      'Step 2: `npm ci` (Node 24) — notes ² **x**',
      '---',
      '',
      '## Caf\u00e9\u200ds \u217b',
      '## a_b x\u0303 \u2460',
    ].join('\n')
    expect([...anchorsIn(text)]).toEqual([
      'guide',
      'indented',
      'lazycontinuation',
      'two-wordsheading',
      'step-2-npm-ci-node-24--notes--x',
      'caf\u00e9\u200ds-\u217b',
      'a_b-x\u0303-',
    ])
  })

  it('numbers repeated heading slugs like GitHub', () => {
    // Expected slugs come from GitHub's Markdown API.
    expect([...anchorsIn('# Foo\n# Foo-1\n# Foo')]).toEqual(['foo', 'foo-1', 'foo-2'])
    expect([...anchorsIn('# Foo\n# Foo\n# Foo-1')]).toEqual(['foo', 'foo-1', 'foo-1-1'])
  })
})
