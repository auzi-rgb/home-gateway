import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import Snapshot from './pages/Snapshot'

function Skeleton() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--bg-nav)', backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'var(--shadow-nav)',
      }}>
        <div style={{ maxWidth: 980, margin: '0 auto', padding: '0 24px',
                      height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 120, height: 14, background: 'var(--bg-subtle)', borderRadius: 7 }} />
        </div>
      </div>
    </div>
  )
}

const TABS = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'projects',  label: 'Library'  },
  { id: 'snapshot',  label: 'Export'   },
]

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [ready, setReady] = useState(false)

  if (!ready) {
    setTimeout(() => setReady(true), 0)
    return <Skeleton />
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>

      {/* Nav bar */}
      <nav style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--bg-nav)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: 'var(--shadow-nav)',
      }}>
        <div style={{
          maxWidth: 980, margin: '0 auto', padding: '0 24px',
          height: 52, display: 'flex', alignItems: 'center', gap: 32,
        }}>
          {/* Logo */}
          <span style={{
            fontSize: 15, fontWeight: 600, color: 'var(--text-primary)',
            letterSpacing: '-0.03em', flexShrink: 0,
          }}>
            <span style={{ color: 'var(--accent)' }}>●</span>{' '}Home AI
          </span>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'center' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setPage(t.id)}
                style={{
                  background: page === t.id ? 'var(--bg-subtle)' : 'transparent',
                  color: page === t.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer',
                  padding: '6px 16px',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 14, fontWeight: page === t.id ? 500 : 400,
                  fontFamily: 'inherit',
                  letterSpacing: '-0.01em',
                  transition: 'all 0.15s ease',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Spacer to balance logo */}
          <div style={{ width: 80, flexShrink: 0 }} />
        </div>
      </nav>

      {/* Pages — keep mounted to avoid re-fetch on tab switch */}
      <div style={{ display: page === 'dashboard' ? 'block' : 'none' }}>
        <Dashboard active={page === 'dashboard'} />
      </div>
      <div style={{ display: page === 'projects' ? 'block' : 'none' }}>
        <Projects />
      </div>
      <div style={{ display: page === 'snapshot' ? 'block' : 'none' }}>
        <Snapshot active={page === 'snapshot'} />
      </div>
    </div>
  )
}
