import { buildApp } from './app.js'

const app = await buildApp()
await app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '127.0.0.1' })
