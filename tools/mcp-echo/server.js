#!/usr/bin/env node
// Minimal stdio MCP server for E2E: one tool, echo(text) → text.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'aiws-echo', version: '1.0.0' })
server.registerTool(
  'echo',
  { description: 'Returns the given text unchanged.', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text }] }),
)
await server.connect(new StdioServerTransport())
