import { useEffect, useState } from 'react'

export function App() {
  const [status, setStatus] = useState('连接中…')
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: { protocol: number }) => setStatus(`已连接 · 协议 v${h.protocol}`))
      .catch(() => setStatus('服务器不可用'))
  }, [])
  return <div style={{ padding: 24 }}>{status}</div>
}
