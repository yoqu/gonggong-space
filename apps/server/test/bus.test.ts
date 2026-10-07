import type { WebEvent } from '@gonggong/protocol'
import { expect, it, vi } from 'vitest'
import { Bus } from '../src/realtime/bus.js'

it('serializes an event once however many connections receive it', () => {
  const bus = new Bus()
  const sent: string[] = []
  for (const user of ['u1', 'u1', 'u2']) bus.attach(user, (_, json) => sent.push(json()))
  const stringify = vi.spyOn(JSON, 'stringify')
  const event: WebEvent = { t: 'run.delta', runId: 'r1', text: 'hi' }
  bus.publish(['u1', 'u2', 'u3'], event)
  expect(stringify).toHaveBeenCalledTimes(1)
  stringify.mockRestore()
  expect(sent).toEqual(Array(3).fill(JSON.stringify(event)))
})
