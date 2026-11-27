import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AudienceFields, type AudienceValue } from '../src/features/bots/AudienceFields'

const fields = (value: AudienceValue, focus: 'trusted' | 'others') =>
  render(
    <AudienceFields
      canEdit
      value={value}
      onChange={() => {}}
      list={[]}
      users={[]}
      ownerId="u1"
      focus={focus}
      onListChange={() => {}}
    />,
  )

describe('AudienceFields focus from an approval card', () => {
  it('a row the request came under but now closed says it still could be triggered back then', () => {
    fields({ trusted: 'ask', others: 'deny' }, 'others')
    expect(screen.getByText('本次请求适用')).toBeTruthy()
    expect(screen.getByText('本次请求发起时仍可触发')).toBeTruthy()
  })

  it('an open focused row needs no such note', () => {
    fields({ trusted: 'ask', others: 'ask' }, 'others')
    expect(screen.getByText('本次请求适用')).toBeTruthy()
    expect(screen.queryByText('本次请求发起时仍可触发')).toBeNull()
  })
})
