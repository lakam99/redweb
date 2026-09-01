import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, truncateSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { DocCatalogue } from '../src/catalogue.mjs'

const canonical = JSON.parse(readFileSync(new URL('../../../docs/generated.json', import.meta.url), 'utf8'))
const entry = path.resolve('src/main.mjs')
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'redweb-docs-mcp-'))
  const file = path.join(root, 'catalogue.json')
  writeFileSync(file, JSON.stringify(canonical))
  return { root, file, put: data => writeFileSync(file, JSON.stringify(data)), close: () => rmSync(root, { recursive: true, force: true }) }
}
const hash = markdown => createHash('sha256').update(markdown).digest('hex')

test('catalogue search and paged reads preserve exact canonical content', () => {
  const f = fixture()
  try {
    const docs = new DocCatalogue(f.file)
    const results = docs.search('chat')
    assert.equal(results.channel, 'unreleased')
    assert.ok(results.results.some(item => item.id === 'recipes/chat'))
    assert.ok(results.results.length <= 8)
    assert.equal(docs.search('chat', 1).results.length, 1)
    assert.equal(docs.search('no-such-word-zxq').total, 0)
    assert.throws(() => docs.search('  '))
    assert.throws(() => docs.search('x'.repeat(257)))
    assert.throws(() => docs.search('chat', 21))
    for (const original of canonical.pages) {
      let offset = 0
      let text = ''
      do {
        const result = docs.read(original.id, { offset, length: 997 })
        text += result.text
        offset = result.nextOffset
      } while (offset !== null)
      assert.equal(text, original.markdown)
      for (const file of original.files ?? []) {
        assert.equal(docs.read(original.id, { file: file.path, length: 16000 }).text, file.content.slice(0, 16000))
      }
    }
    const first = canonical.pages[0]
    assert.equal(docs.read(first.id).offset, 0)
    assert.equal(docs.read(first.id, {}).offset, 0)
    assert.equal(docs.read(first.id, { offset: first.markdown.length }).text, '')
    assert.throws(() => docs.read(first.id, { offset: first.markdown.length + 1 }), /Offset exceeds/)
    assert.throws(() => docs.read('missing'), /Unknown documentation ID/)
    assert.throws(() => docs.read('recipes/chat', { file: '../../package.json' }), /Unknown recipe file/)
    assert.throws(() => docs.read('recipes/chat', { file: 'C:\\private.txt' }), /Unknown recipe file/)
    assert.throws(() => docs.read(first.id, { offset: -1 }))
    assert.throws(() => docs.read(first.id, { length: 16001 }))
    // Mutating returned metadata cannot change later responses.
    results.channel = 'pretend-release'
    assert.equal(docs.read(first.id).channel, 'unreleased')
  } finally { f.close() }
})

test('startup rejects inconsistent metadata, hashes, identities and oversized input', () => {
  const f = fixture()
  try {
    const corruptions = [
      data => { data.schemaVersion = 2 },
      data => { data.packageVersion = 'not-a-version' },
      data => { data.basePath = '/wrong' },
      data => { data.channel = '1.0.0'; data.basePath = '/docs/reference/1.0.0' },
      data => { data.pages.push(data.pages[0]) },
      data => { data.pages[0].url = '/wrong' },
      data => { data.pages[0].markdown += 'tampered' },
      ...['../secret', 'a//b', 'a/./b', 'C:\\secret'].map(name => data => { data.pages[0].files = [{ path: name, content: '' }] }),
      data => { data.pages[0].files = [{ path: 'a.ts', content: '' }, { path: 'a.ts', content: '' }] },
    ]
    for (const corrupt of corruptions) {
      const data = structuredClone(canonical)
      corrupt(data)
      f.put(data)
      assert.throws(() => new DocCatalogue(f.file))
    }
    const release = structuredClone(canonical)
    release.channel = release.packageVersion
    release.basePath = `/docs/reference/${release.channel}`
    for (const page of release.pages) page.url = `${release.basePath}/${page.id}.md`
    f.put(release)
    assert.equal(new DocCatalogue(f.file).search('chat').channel, release.channel)
    writeFileSync(f.file, '{invalid')
    assert.throws(() => new DocCatalogue(f.file))
    truncateSync(f.file, 16 * 1024 * 1024 + 1)
    assert.throws(() => new DocCatalogue(f.file), /exceeds 16 MiB/)
  } finally { f.close() }
})

test('search ranking, ties, empty files and Unicode chunks are deterministic', () => {
  const f = fixture()
  try {
    const data = structuredClone(canonical)
    data.pages = ['b', 'a', 'c'].map(id => ({ id, title: 'Query', summary: 'Summary', markdown: id === 'c' ? 'other' : 'query 😀', sha256: hash(id === 'c' ? 'other' : 'query 😀'), url: `${data.basePath}/${id}.md`, files: [{ path: 'empty', content: '' }] }))
    f.put(data)
    const docs = new DocCatalogue(f.file)
    assert.deepEqual(docs.search('query').results.map(item => item.id), ['a', 'b', 'c'])
    assert.equal(docs.read('a', { file: 'empty' }).nextOffset, null)
    const first = docs.read('a', { length: 7 })
    const second = docs.read('a', { offset: first.nextOffset })
    assert.equal(first.text + second.text, 'query 😀')
  } finally { f.close() }
})

async function connect(entry, file, mode = 'legacy') {
  const transport = new StdioClientTransport({
    command: process.execPath, args: [entry, file], stderr: 'pipe',
    env: process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {},
  })
  const client = new Client({ name: 'redweb-docs-integration', version: '1.0.0' }, { versionNegotiation: { mode } })
  let errors = ''
  transport.stderr.on('data', data => { errors += data })
  try {
    await client.connect(transport, { timeout: 5000 })
    return { client, transport, errors: () => errors }
  } catch (error) {
    await transport.close()
    throw new Error(`${error.message}: ${errors}`)
  }
}

test('actual MCP subprocess lists only read-only tools and reads without filesystem access after startup', { timeout: 15000 }, async () => {
  const f = fixture()
  const session = await connect(entry, f.file)
  try {
    const tools = await session.client.listTools()
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['read_doc', 'read_recipe_file', 'search_docs'])
    for (const tool of tools.tools) {
      assert.equal(tool.annotations.readOnlyHint, true)
      assert.equal(tool.annotations.openWorldHint, false)
    }
    // Only in-memory catalogue content is available after initialization.
    unlinkSync(f.file)
    const call = async (name, args) => {
      const result = await session.client.callTool({ name, arguments: args })
      assert.ok(!result.isError, JSON.stringify(result))
      return JSON.parse(result.content[0].text)
    }
    const search = await call('search_docs', { query: 'counter' })
    assert.equal(search.channel, canonical.channel)
    assert.ok(search.results.some(item => item.id === 'recipes/realtime'))
    const page = await call('read_doc', { id: 'recipes/realtime', length: 123 })
    assert.equal(page.text.length, 123)
    assert.equal(page.nextOffset, 123)
    assert.ok(page.files.includes('src/app.tsx'))
    const file = await call('read_recipe_file', { id: 'recipes/realtime', file: 'src/app.tsx' })
    assert.equal(file.text, canonical.pages.find(page => page.id === 'recipes/realtime').files.find(file => file.path === 'src/app.tsx').content)
    const missing = await session.client.callTool({ name: 'read_doc', arguments: { id: 'missing' } })
    assert.equal(missing.isError, true)
    const unsafe = await session.client.callTool({ name: 'read_recipe_file', arguments: { id: 'recipes/realtime', file: '../../package.json' } })
    assert.equal(unsafe.isError, true)
    const invalid = await session.client.callTool({ name: 'search_docs', arguments: { query: '' } })
    assert.equal(invalid.isError, true)
    assert.equal(session.errors(), '')
  } finally { await session.client.close(); f.close() }
})

test('invalid startup reports on stderr without corrupting protocol stdout', () => {
  for (const args of [[], ['missing-catalogue.json'], ['one', 'two']]) {
    const result = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', timeout: 5000, windowsHide: true })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Redweb documentation server failed/)
  }
})

test('oversized stdio input closes without executing a tool or leaving a process running', () => {
  const f = fixture()
  try {
    const result = spawnSync(process.execPath, [entry, f.file], {
      input: 'x'.repeat(64 * 1024 + 1), encoding: 'utf8', timeout: 5000, windowsHide: true,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.signal, null)
  } finally { f.close() }
})

test('packed adapter serves a packed Redweb catalogue with production-only dependencies', { timeout: 45000 }, async () => {
  const f = fixture()
  let session
  try {
    const npm = (cwd, args) => {
      assert.ok(process.env.npm_execpath, 'Run the adapter gate with npm test')
      const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, encoding: 'utf8', timeout: 30000, windowsHide: true })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout
    }
    const extract = (archive, directory) => {
      mkdirSync(directory, { recursive: true })
      const result = spawnSync('tar', ['-xzf', archive, '-C', directory], { encoding: 'utf8', timeout: 10000, windowsHide: true })
      assert.equal(result.status, 0, result.stderr)
    }
    const [adapter] = JSON.parse(npm(process.cwd(), ['pack', '--json', '--ignore-scripts', '--pack-destination', f.root]))
    assert.ok(!adapter.files.some(file => file.path.startsWith('test/')))
    extract(path.join(f.root, adapter.filename), path.join(f.root, 'adapter'))
    const adapterRoot = path.join(f.root, 'adapter/package')
    npm(adapterRoot, ['install', '--omit=dev', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'])
    const [core] = JSON.parse(npm(path.resolve('../..'), ['pack', '--json', '--pack-destination', f.root]))
    assert.ok(!core.files.some(file => file.path.startsWith('integrations/')), 'Normal Redweb must not ship the optional adapter')
    extract(path.join(f.root, core.filename), path.join(f.root, 'core'))
    const catalogue = path.join(f.root, 'core/package/docs/generated.json')
    session = await connect(path.join(adapterRoot, 'src/main.mjs'), catalogue, { pin: '2026-07-28' })
    const result = await session.client.callTool({ name: 'read_recipe_file', arguments: { id: 'recipes/chat', file: 'src/app.tsx', length: 16000 } })
    assert.ok(!result.isError)
    const data = JSON.parse(result.content[0].text)
    assert.equal(data.text, canonical.pages.find(page => page.id === 'recipes/chat').files.find(file => file.path === 'src/app.tsx').content)
    assert.equal(session.errors(), '')
  } finally { if (session) await session.client.close(); f.close() }
})
