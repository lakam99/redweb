import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { querySchema, idSchema, offsetSchema, lengthSchema } from './catalogue.mjs'

export function createServer(catalogue) {
  const server = new McpServer({ name: 'redweb-docs', version: '0.1.0' })
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  const register = (name, description, inputSchema, run) => server.registerTool(name, {
    description, inputSchema, annotations,
  }, args => ({ content: [{ type: 'text', text: JSON.stringify(run(args)) }] }))
  register('search_docs', 'Search the selected Redweb documentation version. Returns ranked IDs and summaries; use read_doc next. Unreleased means NOT the published npm package.',
    z.object({ query: querySchema, limit: z.number().int().min(1).max(20).default(8) }),
    ({ query, limit }) => catalogue.search(query, limit))
  register('read_doc', 'Read a canonical Redweb Markdown page and list its recipe files. Follow nextOffset for the remainder; offsets count JavaScript UTF-16 characters, not bytes.',
    z.object({ id: idSchema, offset: offsetSchema, length: lengthSchema }),
    ({ id, offset, length }) => catalogue.read(id, { offset, length }))
  register('read_recipe_file', 'Read an exact file embedded in a documented recipe. Only listed filenames are accepted; this never reads an arbitrary local file or executes code.',
    z.object({ id: idSchema, file: z.string().min(1).max(256), offset: offsetSchema, length: lengthSchema }),
    ({ id, file, offset, length }) => catalogue.read(id, { file, offset, length }))
  return server
}
