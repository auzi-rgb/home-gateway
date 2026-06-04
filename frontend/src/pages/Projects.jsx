import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'

const API = '/gateway/api'

function fmt(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function stripTimestamp(filename) {
  return filename.replace(/^\d{8}_\d{6}_/, '')
}

// ── Icon components ──────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 8v2h14v-2H5z"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/>
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.35 }}>
      <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
    </svg>
  )
}

// ── IconBtn ──────────────────────────────────────────────────────────────────

function IconBtn({ title, onClick, children, danger, active }) {
  const [hover, setHover] = useState(false)
  let bg = 'transparent'
  if (active) bg = 'var(--accent-dim)'
  else if (hover && danger) bg = 'rgba(255,59,48,0.1)'
  else if (hover) bg = 'var(--bg-subtle)'

  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: bg,
        border: 'none', cursor: 'pointer',
        width: 28, height: 28, borderRadius: 7,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? 'var(--accent-text)' : danger ? 'var(--red)' : 'var(--text-secondary)',
        transition: 'background 0.12s, color 0.12s',
        flexShrink: 0,
      }}
    >{children}</button>
  )
}

// ── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ projectId, onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  async function upload(file) {
    if (!file.name.endsWith('.md')) { alert('Only .md files are allowed'); return }
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    const r = await fetch(`${API}/projects/${projectId}/files`, { method: 'POST', body: form })
    setUploading(false)
    if (!r.ok) { alert('Upload failed'); return }
    onUploaded()
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) upload(f) }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '16px 12px',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragging ? 'var(--accent-dim)' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      <input ref={inputRef} type="file" accept=".md,text/markdown" style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) { upload(e.target.files[0]); e.target.value = '' } }} />
      <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}><UploadIcon /></div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        {uploading ? 'Uploading…' : 'Drop .md here or click to browse'}
      </div>
    </div>
  )
}

// ── Detail panel (middle column) ─────────────────────────────────────────────

function DetailPanel({ project, previewFileId, onPreview, onUpdate, onDelete }) {
  const [notes, setNotes]             = useState(project.notes || '')
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [confirmDeleteFile, setConfirmDeleteFile] = useState(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    setNotes(project.notes || '')
    setSaved(false)
    setConfirmDeleteFile(null)
    setConfirmDeleteProject(false)
  }, [project.id])

  function handleNotes(val) {
    setNotes(val); setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      await fetch(`${API}/projects/${project.id}/notes`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: val }),
      })
      setSaving(false); setSaved(true)
    }, 800)
  }

  async function deleteFile(fileId) {
    await fetch(`${API}/projects/${project.id}/files/${fileId}`, { method: 'DELETE' })
    if (previewFileId === fileId) onPreview(null)
    setConfirmDeleteFile(null)
    onUpdate()
  }

  function download(file) {
    const a = document.createElement('a')
    a.href = `${API}/projects/${project.id}/files/${file.id}/download`
    a.download = file.filename
    a.click()
  }

  const files = [...(project.files || [])].sort(
    (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)
  )

  return (
    <div style={{
      width: 340, flexShrink: 0,
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      height: '100%', overflowY: 'auto',
      background: 'var(--bg-card)',
    }}>
      <div style={{ padding: '24px 20px', flex: 1 }}>

        {/* Project heading */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text-primary)', marginBottom: 3 }}>
            {project.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Created {fmt(project.created_at)}
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 28 }}>
          <div className="apple-label" style={{ marginBottom: 8 }}>Notes</div>
          <textarea
            value={notes}
            onChange={e => handleNotes(e.target.value)}
            placeholder="Add notes about this project…"
            className="apple-input"
            style={{ height: 100, resize: 'vertical', lineHeight: 1.5, fontSize: 13 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3 }}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Auto-saves after 800 ms'}
          </div>
        </div>

        {/* Files section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span className="apple-label">Files</span>
            {files.length > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600,
                background: 'var(--border)', color: 'var(--text-tertiary)',
                padding: '1px 7px', borderRadius: 10,
              }}>{files.length}</span>
            )}
          </div>

          <DropZone projectId={project.id} onUploaded={onUpdate} />

          {files.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {files.map(f => {
                const isActive = previewFileId === f.id
                const isConfirm = confirmDeleteFile === f.id
                return (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                    background: isActive ? 'var(--accent-dim)' : 'var(--bg-subtle)',
                    transition: 'background 0.15s',
                  }}>
                    {/* File icon */}
                    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
                      <path d="M8 0H2C.9 0 0 .9 0 2v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6L8 0zm0 1.5L12.5 6H8V1.5zM2 14V2h4v6h6v6H2z" fill="currentColor"/>
                    </svg>

                    {/* Name + date */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 500,
                        color: isActive ? 'var(--accent-text)' : 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {stripTimestamp(f.filename)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                        {fmt(f.uploaded_at)}
                      </div>
                    </div>

                    {/* Action buttons or delete confirm */}
                    {isConfirm ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Delete?</span>
                        <button onClick={() => deleteFile(f.id)} style={{
                          background: 'var(--red)', color: '#fff', border: 'none',
                          borderRadius: 5, padding: '2px 8px', fontSize: 11,
                          cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
                        }}>Yes</button>
                        <button onClick={() => setConfirmDeleteFile(null)} style={{
                          background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
                          border: 'none', borderRadius: 5, padding: '2px 8px',
                          fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                        }}>No</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                        <IconBtn title="Preview" active={isActive} onClick={() => onPreview(isActive ? null : f)}>
                          <EyeIcon />
                        </IconBtn>
                        <IconBtn title="Download" onClick={() => download(f)}>
                          <DownloadIcon />
                        </IconBtn>
                        <IconBtn title="Delete" danger onClick={() => setConfirmDeleteFile(f.id)}>
                          <TrashIcon />
                        </IconBtn>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete project — footer */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
        {confirmDeleteProject ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Delete this project?</span>
            <button onClick={onDelete} style={{
              background: 'var(--red)', color: '#fff', border: 'none',
              borderRadius: 5, padding: '3px 10px', fontSize: 12,
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            }}>Yes, delete</button>
            <button onClick={() => setConfirmDeleteProject(false)} style={{
              background: 'transparent', color: 'var(--text-tertiary)',
              border: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDeleteProject(true)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'inherit',
            padding: 0, transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
          >
            Delete project…
          </button>
        )}
      </div>
    </div>
  )
}

// ── Preview pane (right column) ───────────────────────────────────────────────

function PreviewPane({ file, projectId, onClose }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!file) return
    setContent(null); setLoading(true)
    fetch(`${API}/projects/${projectId}/files/${file.id}/content`)
      .then(r => r.json())
      .then(d => { setContent(d.content); setLoading(false) })
      .catch(() => { setContent('Failed to load.'); setLoading(false) })
  }, [file?.id])

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      height: '100%', overflow: 'hidden',
      background: 'var(--bg)',
    }}>
      {file ? (
        <>
          {/* Header bar */}
          <div style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {stripTimestamp(file.filename)}
            </div>
            <button onClick={onClose} style={{
              background: 'var(--bg-subtle)', border: 'none', cursor: 'pointer',
              borderRadius: 'var(--radius-pill)', padding: '4px 12px',
              fontSize: 13, color: 'var(--text-secondary)',
              fontFamily: 'inherit', flexShrink: 0, marginLeft: 12,
            }}>✕ Close</button>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {loading ? (
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Loading…</div>
            ) : (
              <div className="markdown-body">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-tertiary)',
        }}>
          <EyeIcon />
          <div style={{ fontSize: 14, marginTop: 10 }}>Select a file to preview</div>
        </div>
      )}
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function Projects() {
  const [projects, setProjects]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [selectedProject, setSelectedProject] = useState(null)
  const [previewFile, setPreviewFile]         = useState(null)
  const [search, setSearch]       = useState('')
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const nameRef = useRef(null)

  const load = useCallback(async (keepSelected = true) => {
    try {
      const r = await fetch(`${API}/projects`)
      const data = await r.json()
      setProjects(data)
      if (keepSelected && selectedProject) {
        const up = data.find(p => p.id === selectedProject.id)
        setSelectedProject(up ?? null)
      }
    } catch (e) {} finally { setLoading(false) }
  }, [selectedProject?.id])

  useEffect(() => { load(false) }, [])
  useEffect(() => { if (creating) nameRef.current?.focus() }, [creating])

  async function create() {
    const name = newName.trim()
    if (!name) return
    const r = await fetch(`${API}/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    const proj = await r.json()
    setNewName(''); setCreating(false)
    const r2 = await fetch(`${API}/projects`)
    const data = await r2.json()
    setProjects(data)
    setLoading(false)
    const fresh = data.find(p => p.id === proj.id) ?? proj
    setSelectedProject(fresh)
    setPreviewFile(null)
  }

  async function deleteProject() {
    if (!selectedProject) return
    await fetch(`${API}/projects/${selectedProject.id}`, { method: 'DELETE' })
    setSelectedProject(null); setPreviewFile(null)
    load(false)
  }

  function handlePreview(file) {
    setPreviewFile(file)
  }

  const sorted = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-nav)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 14px 8px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Library
          </span>
          {!creating && (
            <button onClick={() => setCreating(true)} style={{
              background: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: 6, padding: '3px 9px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', letterSpacing: '-0.01em',
            }}>+ New</button>
          )}
        </div>

        {/* Inline new-project form */}
        {creating && (
          <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              ref={nameRef} type="text" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') create()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder="Project name"
              className="apple-input"
              style={{ fontSize: 13, padding: '6px 10px', marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 5 }}>
              <button className="apple-btn-primary" onClick={create}
                style={{ fontSize: 12, padding: '4px 12px', flex: 1 }}>Create</button>
              <button className="apple-btn-secondary" onClick={() => { setCreating(false); setNewName('') }}
                style={{ fontSize: 12, padding: '4px 10px' }}>✕</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div style={{ padding: '8px 10px 4px', flexShrink: 0 }}>
          <input
            type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="apple-input"
            style={{ fontSize: 12, padding: '5px 10px' }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 8px' }}>
          {loading ? (
            <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-tertiary)' }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              {search ? 'No matches' : 'No projects yet'}
            </div>
          ) : sorted.map(p => {
            const active = selectedProject?.id === p.id
            return (
              <button key={p.id} onClick={() => { setSelectedProject(p); setPreviewFile(null) }} style={{
                width: '100%', textAlign: 'left',
                background: active ? 'var(--bg-subtle)' : 'transparent',
                border: 'none',
                borderLeft: `3px solid ${active ? 'var(--accent)' : 'transparent'}`,
                borderRadius: '0 6px 6px 0',
                padding: '7px 8px 7px 7px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 6, marginBottom: 1, transition: 'all 0.12s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-subtle)' }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{
                  fontSize: 13, fontWeight: active ? 500 : 400,
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{p.name}</span>
                {p.files.length > 0 && (
                  <span style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 600,
                    background: active ? 'var(--accent-dim)' : 'var(--border)',
                    color: active ? 'var(--accent-text)' : 'var(--text-tertiary)',
                    padding: '1px 6px', borderRadius: 8,
                  }}>{p.files.length}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '8px 14px', borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0,
        }}>
          {projects.length} project{projects.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Detail panel ── */}
      {selectedProject ? (
        <DetailPanel
          key={selectedProject.id}
          project={selectedProject}
          previewFileId={previewFile?.id ?? null}
          onPreview={handlePreview}
          onUpdate={() => load(true)}
          onDelete={deleteProject}
        />
      ) : (
        <div style={{
          width: 340, flexShrink: 0,
          borderRight: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-card)',
        }}>
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
            <div style={{ fontSize: 13 }}>Select a project</div>
          </div>
        </div>
      )}

      {/* ── Preview pane ── */}
      <PreviewPane
        file={previewFile}
        projectId={selectedProject?.id}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  )
}
