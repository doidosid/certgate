import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Backend 없이 화면만 보고 싶을 때만 켠다. 기본값이 아니므로 운영 Build에는
// Mock 코드가 실행되지 않는다(동적 import라 번들에도 별도 chunk로 빠진다).
if (import.meta.env.VITE_USE_MOCK === 'true') {
  const { startMockWorker } = await import('./mocks/browser')
  await startMockWorker()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
