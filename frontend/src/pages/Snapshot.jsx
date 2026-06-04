import { useState, useEffect } from 'react'

const API = '/gateway/api'

export default function Snapshot({ active }) {
  const [content, setContent]         = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [projects, setProjects]       = useState([])
  const [saving, setSaving]           = useState(false)
  const [savedTo, setSavedTo]         = useState(null)

  useEffect(() => {
    fetch(`${API}/projects`).then(r => r.json()).then(setProjects).catch(() => {})
  }, [active])

  async function generate() {
    setLoading(true); setContent(null); setSavedTo(null)
    try {
      const r = await fetch(`${API}/snapshot/live`)
      const data = await r.json()
      setContent(data.content); setGeneratedAt(data.generated_at)
    } catch {
      setContent('Failed to generate snapshot.')
    } finally { setLoading(false) }
  }

  function download() {
    const blob = new Blob([content], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `home-lab-snapshot-${new Date().toISOString().slice(0,10)}.md`
    a.click()
  }

  async function saveToProject(projectId) {
    if (!projectId || !content) return
    setSaving(true)
    try {
      const filename = `snapshot-${new Date().toISOString().slice(0,10)}.md`
      const file = new File([new Blob([content])], filename, { type: 'text/markdown' })
      const form = new FormData(); form.append('file', file)
      await fetch(`${API}/projects/${projectId}/files`, { method: 'POST', body: form })
      setSavedTo(projects.find(p => p.id === parseInt(projectId))?.name || 'project')
    } catch { alert('Failed to save') } finally { setSaving(false) }
  }

  return (
    <div className="page-enter" style={{ maxWidth: 980, margin: '0 auto', padding: '48px 24px 80px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 40 }}>
        <div>
          <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.05em',
                       color: 'var(--text-primary)', marginBottom: 8 }}>
            Export
          </h1>
          <p style={{ fontSize: 17, color: 'var(--text-secondary)', margin: 0 }}>
            Generate a live context snapshot of your home lab for Claude
          </p>
        </div>
        <button className="apple-btn-primary" onClick={generate} disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading ? (
            <>
              <span style={{
                width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              Generating
            </>
          ) : '↻ Generate'}
        </button>
      </div>

      {/* Empty */}
      {!content && !loading && (
        <div className="apple-card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em',
                        color: 'var(--text-primary)', marginBottom: 8 }}>
            Ready to snapshot
          </div>
          <div style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 32, maxWidth: 400, margin: '0 auto 32px' }}>
            Pulls live data from your app server and AI node — software versions, running services, models, and more
          </div>
          <button className="apple-btn-primary" onClick={generate} style={{ fontSize: 16, padding: '12px 28px' }}>
            Generate Snapshot
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="apple-card" style={{ padding: '80px 24px', textAlign: 'center' }}>
          <div style={{
            width: 36, height: 36, border: '3px solid var(--border)',
            borderTopColor: 'var(--accent)', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 20px',
          }} />
          <div style={{ fontSize: 17, color: 'var(--text-secondary)' }}>
            Gathering live data...
          </div>
        </div>
      )}

      {/* Content */}
      {content && !loading && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Generated {generatedAt}</span>
            <div style={{ flex: 1 }} />
            {savedTo && (
              <span className="apple-pill apple-pill-green" style={{ fontSize: 13 }}>
                ✓ Saved to {savedTo}
              </span>
            )}
            {projects.length > 0 && (
              <select
                onChange={e => { if (e.target.value) saveToProject(e.target.value); e.target.value = '' }}
                disabled={saving}
                style={{
                  background: 'var(--bg-subtle)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-pill)', padding: '6px 14px',
                  fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit',
                  cursor: 'pointer', outline: 'none',
                }}
              >
                <option value="">Save to Library...</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button className="apple-btn-secondary" onClick={generate} style={{ fontSize: 13 }}>
              ↻ Refresh
            </button>
            <button className="apple-btn-primary" onClick={download} style={{ fontSize: 13 }}>
              ↓ Download .md
            </button>
          </div>

          <div className="apple-card" style={{ overflow: 'hidden' }}>
            <div style={{
              padding: '12px 20px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-subtle)',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)',
                             fontFamily: 'ui-monospace, monospace' }}>
                home-lab-snapshot.md
              </span>
            </div>
            <textarea
              readOnly value={content}
              style={{
                width: '100%', height: '60vh', padding: 24,
                background: 'transparent', border: 'none', outline: 'none',
                fontFamily: 'ui-monospace, monospace', fontSize: 13,
                color: 'var(--text-primary)', lineHeight: 1.6, resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
