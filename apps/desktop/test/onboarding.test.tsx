import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './ipc-mock'
import { type BindLink, ipc } from '../src/ipc'
import { Onboarding } from '../src/onboarding/Onboarding'
import { INFO } from './ipc-mock'

const m = vi.mocked(ipc)

const LINK = 'gonggong://bind?server=https%3A%2F%2Fgonggong.corp.cn&code=K7QM-4X2P'
const COMMAND = 'gg login --server https://gonggong.corp.cn --code k7qm-4x2p'
const PARSED: BindLink = { server: 'https://gonggong.corp.cn', code: 'K7QM-4X2P', fingerprint: null }
const PINNED: BindLink = { ...PARSED, fingerprint: 'sha256:AB:CD' }

beforeEach(() => {
  vi.clearAllMocks()
  m.appInfo.mockResolvedValue(INFO)
  m.login.mockResolvedValue()
  m.startDaemon.mockResolvedValue()
  m.readClipboard.mockResolvedValue('')
  m.parseLink.mockImplementation(async (input) => {
    if (input.trim() === LINK || input.trim() === COMMAND) return PARSED
    if (input.includes('fp=')) return PINNED
    throw '无法识别：请粘贴接入链接或 gg login 命令'
  })
})

const input = () => screen.getByLabelText('接入链接') as HTMLInputElement
const bindButton = () => screen.getByRole('button', { name: '绑定' })

function paste(text: string) {
  fireEvent.change(input(), { target: { value: text } })
}

describe('onboarding', () => {
  it('parses a pasted command, shows the server and binds on 绑定', async () => {
    const onDone = vi.fn()
    render(<Onboarding link={null} onDone={onDone} />)
    expect(screen.getByText('绑定到团队服务器')).toBeTruthy()
    expect(input().placeholder).toBe('粘贴网页上复制的接入链接或 gg login 命令')
    expect(bindButton()).toHaveProperty('disabled', true)

    paste(COMMAND)
    await screen.findByText('gonggong.corp.cn')
    expect(screen.getByText('K7QM-4X2P')).toBeTruthy()
    expect(screen.queryByText('已固定证书指纹')).toBeNull()
    expect(m.login).not.toHaveBeenCalled()

    fireEvent.click(bindButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(m.login).toHaveBeenCalledWith(PARSED)
    expect(m.startDaemon).toHaveBeenCalled()
    expect(m.appInfo).toHaveBeenCalled()
  })

  it('says why the input is not a link and keeps 绑定 disabled', async () => {
    render(<Onboarding link={null} onDone={() => {}} />)
    paste('K7QM-4X2P')
    await screen.findByText('无法识别：请粘贴接入链接或 gg login 命令')
    expect(bindButton()).toHaveProperty('disabled', true)
  })

  it('shows a pinned certificate and why binding failed', async () => {
    m.login.mockRejectedValue('绑定失败：绑定码已失效（已过期或已被使用），请在 Web 端重新生成')
    const onDone = vi.fn()
    render(<Onboarding link={null} onDone={onDone} />)
    paste(`${LINK}&fp=sha256:ab:cd`)
    await screen.findByText('已固定证书指纹')
    fireEvent.click(bindButton())
    await screen.findByText('绑定失败：绑定码已失效（已过期或已被使用），请在 Web 端重新生成')
    expect(m.login).toHaveBeenCalledWith(PINNED)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('prefills from the clipboard when the window gets focus', async () => {
    render(<Onboarding link={null} onDone={() => {}} />)
    m.readClipboard.mockResolvedValue(`  ${LINK}\n`)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await screen.findByText('gonggong.corp.cn')
    expect(input().value).toBe(LINK)
    expect(m.login).not.toHaveBeenCalled()
  })

  it('leaves the input alone when the clipboard holds something else', async () => {
    m.readClipboard.mockResolvedValue('hello')
    render(<Onboarding link={null} onDone={() => {}} />)
    paste(COMMAND)
    await screen.findByText('gonggong.corp.cn')
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(input().value).toBe(COMMAND)
  })

  it('never replaces a link already in the input with another one from the clipboard', async () => {
    const other = 'gonggong://bind?server=https%3A%2F%2Fother.corp&code=AAAA-BBBB&fp=sha256:ab'
    render(<Onboarding link={{ url: LINK }} onDone={() => {}} />)
    await screen.findByText('gonggong.corp.cn')
    m.readClipboard.mockResolvedValue(other)
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(input().value).toBe(LINK)
  })

  it('prefills an opened link but binds only on 绑定', async () => {
    const onDone = vi.fn()
    render(<Onboarding link={{ url: LINK }} onDone={onDone} />)
    await screen.findByText('gonggong.corp.cn')
    expect(input().value).toBe(LINK)
    expect(m.login).not.toHaveBeenCalled()
    fireEvent.click(bindButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(m.login).toHaveBeenCalledWith(PARSED)
  })
})
