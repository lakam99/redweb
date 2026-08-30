import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const source = z.object({ path: z.string().max(256), content: z.string() })
const version = z.string().max(128).regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/)
const page = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/).max(128),
  title: z.string().max(256), summary: z.string().max(2048),
  markdown: z.string(), sha256: z.string(), url: z.string(),
  files: z.array(source).max(100).optional(),
})
const schema = z.object({
  schemaVersion: z.literal(1), packageVersion: version,
  channel: z.union([z.literal('unreleased'), version]),
  basePath: z.string(), pages: z.array(page).min(1).max(1000),
})
export const querySchema = z.string().trim().min(1).max(256)
export const idSchema = z.string().min(1).max(128)
export const offsetSchema = z.number().int().min(0).max(16 * 1024 * 1024).default(0)
export const lengthSchema = z.number().int().min(1).max(16000).default(8000)

/** Immutable, startup-only content. Requests select catalogue IDs, never disk paths. */
export class DocCatalogue {
  #pages
  #version
  constructor(file) {
    if (statSync(file).size > 16 * 1024 * 1024) throw new Error('Documentation catalogue exceeds 16 MiB')
    const data = schema.parse(JSON.parse(readFileSync(file, 'utf8')))
    if (data.basePath !== `/docs/reference/${data.channel}` || (data.channel !== 'unreleased' && data.channel !== data.packageVersion)) throw new Error('Documentation version mismatch')
    const pages = new Map()
    for (const item of data.pages) {
      if (pages.has(item.id) || item.url !== `${data.basePath}/${item.id}.md`) throw new Error('Invalid documentation identity')
      if (createHash('sha256').update(item.markdown).digest('hex') !== item.sha256) throw new Error('Documentation hash mismatch')
      const files = new Map()
      for (const file of item.files ?? []) {
        if (files.has(file.path) || /[\\:]/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid recipe file identity')
        files.set(file.path, file.content)
      }
      pages.set(item.id, { ...item, files })
    }
    this.#pages = pages
    this.#version = Object.freeze({ packageVersion: data.packageVersion, channel: data.channel, basePath: data.basePath })
  }

  search(query, limit = 8) {
    const terms = querySchema.parse(query).toLowerCase().split(/\s+/)
    z.number().int().min(1).max(20).parse(limit)
    const matches = [...this.#pages.values()].map(page => {
      const title = `${page.id} ${page.title}`.toLowerCase()
      const summary = page.summary.toLowerCase()
      const body = page.markdown.toLowerCase()
      const score = terms.reduce((score, term) => score + (title.includes(term) ? 10 : 0) + (summary.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0), 0)
      return { id: page.id, title: page.title, summary: page.summary, url: page.url, score }
    }).filter(page => page.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    return { ...this.#version, total: matches.length, results: matches.slice(0, limit) }
  }

  read(id, { file, offset = 0, length = 8000 } = {}) {
    idSchema.parse(id)
    offsetSchema.parse(offset)
    lengthSchema.parse(length)
    const page = this.#pages.get(id)
    if (!page) throw new Error('Unknown documentation ID; search_docs lists available IDs')
    const content = file === undefined ? page.markdown : page.files.get(z.string().min(1).max(256).parse(file))
    if (content === undefined) throw new Error('Unknown recipe file; read_doc lists exact filenames')
    if (offset > content.length) throw new Error('Offset exceeds document length')
    const end = Math.min(offset + length, content.length)
    return {
      ...this.#version, id, url: page.url, title: page.title,
      files: [...page.files.keys()], totalCharacters: content.length,
      offset, nextOffset: end < content.length ? end : null,
      text: content.slice(offset, end),
    }
  }
}
