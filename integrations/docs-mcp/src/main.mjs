import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { DocCatalogue } from './catalogue.mjs'
import { createServer } from './server.mjs'

try {
  if (process.argv.length !== 3) throw new Error('Usage: node src/main.mjs /absolute/path/to/redweb/docs/generated.json')
  const catalogue = new DocCatalogue(process.argv[2])
  serveStdio(() => createServer(catalogue), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 64 * 1024 }),
  })
} catch (error) {
  console.error(`Redweb documentation server failed: ${error.message}`)
  process.exitCode = 1
}
