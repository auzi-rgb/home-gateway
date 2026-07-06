import { useState, useEffect, useRef } from 'react'

const API = '/gateway/api'

function fmt(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  })
}

function fmtShort(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', second: '2-digit'
  })
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '-'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
}

function pct(value, total) {
  if (!total) return 0
  return Math.min(100, Math.round(value / total * 100))
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className="apple-card" style={{ padding: '20px 24px' }}>
      <div className="apple-label" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 600, letterSpacing: '-0.04em',
        color: accent ? 'var(--accent-text)' : 'var(--text-primary)',
        lineHeight: 1.1, marginBottom: 4,
      }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ value, color = 'var(--accent)' }) {
  return (
    <div style={{
      height: 4, background: 'var(--bg-subtle)', borderRadius: 2, overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', width: `${value}%`, background: color,
        borderRadius: 2, transition: 'width 0.5s ease',
      }} />
    </div>
  )
}

function TopologyNode({ label, sub, active, accent }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: 14,
      padding: '14px 18px',
      boxShadow: active
        ? '0 0 0 1.5px var(--accent), var(--shadow-card)'
        : 'var(--shadow-card)',
      minWidth: 140,
      transition: 'box-shadow 0.3s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: active ? 'var(--accent)' : 'var(--text-tertiary)',
          boxShadow: active ? '0 0 0 3px var(--accent-dim)' : 'none',
          transition: 'all 0.3s ease',
        }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          {label}
        </span>
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 16 }}>{sub}</div>}
    </div>
  )
}

function ConnectorLine({ active }) {
  return (
    <div style={{ flex: 1, position: 'relative', height: 2, minWidth: 40 }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: active
          ? 'linear-gradient(90deg, var(--accent), var(--accent))'
          : 'var(--border)',
        borderRadius: 1,
        transition: 'background 0.3s ease',
      }} />
      {active && (
        <div style={{
          position: 'absolute', top: 0, height: '100%', width: '40%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
          borderRadius: 1,
          animation: 'flow 1.5s ease-in-out infinite',
        }} />
      )}
    </div>
  )
}

export default function Dashboard({ active }) {
  const [health, setHealth]       = useState(null)
  const [nodeStats, setNodeStats] = useState(null)
  const [models, setModels]       = useState([])
  const [usage, setUsage]         = useState(null)
  const [activity, setActivity]   = useState([])
  const [topology, setTopology]   = useState({ active_model: null, connections: [] })
  const [gatewayStatus, setGatewayStatus] = useState(null)
  const abortRef = useRef(null)
  const timerRef = useRef(null)

  function fetchAll() {
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()
    const sig = abortRef.current.signal
    const get = url => fetch(url, { signal: sig }).then(r => r.json()).catch(() => null)

    get(`${API}/health`).then(d => d && setHealth(d))
    get(`${API}/node-stats`).then(d => d && setNodeStats(d))
    get(`${API}/models`).then(d => d && setModels(d.models || []))
    get(`${API}/usage`).then(d => d && setUsage(d))
    get(`${API}/activity`).then(d => d && setActivity(d))
    get(`${API}/topology`).then(d => d && setTopology(d))
    get(`${API}/gateway/status`).then(d => d && setGatewayStatus(d))
  }

  useEffect(() => {
    if (active) {
      fetchAll()
      timerRef.current = setInterval(fetchAll, 30000)
    } else {
      clearInterval(timerRef.current)
      if (abortRef.current) abortRef.current.abort()
    }
    return () => { clearInterval(timerRef.current); abortRef.current?.abort() }
  }, [active])

  const ollamaOk = health?.ollama === 'ok'
  const healthLoaded = health !== null
  const aiOffline = healthLoaded && !ollamaOk
  const hasActiveModel = nodeStats?.active_model
  const queue = gatewayStatus?.queue || health?.queue || {}
  const requestStats = gatewayStatus?.requests || {}
  const activeRequests = gatewayStatus?.active_requests || []
  const activeCount = queue.active ?? 0
  const waitingCount = queue.waiting ?? 0
  const concurrencyLimit = queue.concurrency_limit ?? 0
  const queueLimit = queue.queue_limit ?? 0
  const loadPercent = pct(activeCount, concurrencyLimit)
  const waitPercent = pct(waitingCount, queueLimit)
  const gatewayMode = aiOffline
    ? 'Node offline'
    : waitingCount > 0
      ? 'Queueing'
      : activeCount > 0
        ? 'Serving'
        : 'Ready'

  return (
    <div className="page-enter" style={{ maxWidth: 1120, margin: '0 auto', padding: '48px 24px 80px' }}>

      {/* Page title */}
      <div style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.05em',
                     color: 'var(--text-primary)', marginBottom: 8 }}>
          Overview
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className={`apple-pill ${ollamaOk ? 'apple-pill-green' : 'apple-pill-neutral'}`}>
            <span className={`apple-dot ${ollamaOk ? 'apple-dot-green apple-dot-pulse' : 'apple-dot-gray'}`} />
            {!healthLoaded ? 'Connecting...' : ollamaOk ? 'All Systems Online' : 'AI Node Offline'}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>10.0.0.24 to 10.0.0.8</span>
        </div>
      </div>

      {aiOffline && (
        <div style={{
          background: 'rgba(255,149,0,0.10)',
          border: '1px solid rgba(255,149,0,0.28)',
          borderRadius: 'var(--radius)',
          padding: '18px 22px',
          marginBottom: 32,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}>
          <div style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: 'var(--orange)',
            flexShrink: 0,
            marginTop: 6,
            boxShadow: '0 0 0 4px rgba(255,149,0,0.12)',
          }} />
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
              marginBottom: 4,
            }}>
              Gateway is online, but austin-ai is not reachable.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Check that the AI laptop has power, is awake, is on the wired LAN, and that Ollama is running on port 11434.
              Model lists and new AI requests will be unavailable until the node reconnects.
            </div>
          </div>
        </div>
      )}

      {/* Active model banner */}
      {hasActiveModel && (
        <div style={{
          background: 'var(--accent-dim)',
          borderRadius: 'var(--radius)',
          padding: '20px 24px',
          marginBottom: 32,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--accent)', flexShrink: 0,
            boxShadow: '0 0 0 4px var(--accent-dim)',
            animation: 'dot-pulse 2s ease-in-out infinite',
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'var(--accent-text)', fontWeight: 500, marginBottom: 2 }}>
              Model Active
            </div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)',
                          fontFamily: 'ui-monospace, monospace', letterSpacing: '-0.02em' }}>
              {nodeStats.active_model}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {nodeStats.active_model_size_gb} GB in memory
            </div>
            {nodeStats.cpu_percent !== null && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                CPU {nodeStats.cpu_percent}% · RAM {nodeStats.ram_used_gb}/{nodeStats.ram_total_gb} GB
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        <StatCard label="Gateway" value={gatewayMode} sub="traffic cop" accent={!aiOffline} />
        <StatCard
          label="AI Node"
          value={!healthLoaded ? '-' : ollamaOk ? 'Online' : 'Offline'}
          sub={ollamaOk ? 'austin-ai - 10.0.0.8' : 'No connection to Ollama'}
          accent={ollamaOk}
        />
        <StatCard
          label="Queue"
          value={`${activeCount}/${concurrencyLimit || '-'}`}
          sub={`${waitingCount} waiting of ${queueLimit || '-'} max`}
          accent={waitingCount > 0 || activeCount > 0}
        />
        <StatCard
          label="Models Available"
          value={models.length || '-'}
          sub={models.length ? `${models.map(m => (m.size/1e9).toFixed(0)).reduce((a,b)=>+a+ +b,0)} GB total` : aiOffline ? 'AI node offline' : 'Loading'}
        />
      </div>

      {/* Traffic cop */}
      <div className="apple-card" style={{ padding: '24px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em', marginBottom: 4 }}>
              Traffic Cop
            </h2>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Concurrency, queue pressure, and recent gateway performance
            </div>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
            {gatewayStatus?.refreshed_at ? `Refreshed ${fmtShort(gatewayStatus.refreshed_at)}` : 'Waiting for status'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr 1fr', gap: 18 }}>
          <div>
            <div className="apple-label" style={{ marginBottom: 8 }}>Active slots</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span>{activeCount} running</span>
              <span style={{ color: 'var(--text-secondary)' }}>{concurrencyLimit || '-'} max</span>
            </div>
            <ProgressBar value={loadPercent} color={activeCount >= concurrencyLimit && concurrencyLimit ? 'var(--red)' : 'var(--accent)'} />
          </div>

          <div>
            <div className="apple-label" style={{ marginBottom: 8 }}>Wait queue</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span>{waitingCount} waiting</span>
              <span style={{ color: 'var(--text-secondary)' }}>{queueLimit || '-'} max</span>
            </div>
            <ProgressBar value={waitPercent} color={queue?.is_full ? 'var(--red)' : 'var(--blue)'} />
          </div>

          <div>
            <div className="apple-label" style={{ marginBottom: 8 }}>Avg latency</div>
            <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.04em' }}>
              {fmtMs(requestStats.avg_duration_ms)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              wait {fmtMs(requestStats.avg_wait_ms)}
            </div>
          </div>

          <div>
            <div className="apple-label" style={{ marginBottom: 8 }}>Recent failures</div>
            <div style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-0.04em',
              color: requestStats.recent_failures ? 'var(--red)' : 'var(--accent-text)',
            }}>
              {requestStats.recent_failures ?? '-'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              last {requestStats.recent_count ?? 0} requests
            </div>
          </div>
        </div>

        {activeRequests.length > 0 && (
          <div style={{ marginTop: 22, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="apple-label" style={{ marginBottom: 10 }}>In flight</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeRequests.map(req => (
                <div key={req.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr 110px 110px',
                  gap: 12,
                  alignItems: 'center',
                  fontSize: 13,
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-subtle)',
                }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--blue)' }}>{req.endpoint}</span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {req.model}
                  </span>
                  <span style={{ color: 'var(--text-secondary)' }}>{req.app_name}</span>
                  <span style={{ color: 'var(--text-tertiary)', textAlign: 'right' }}>{fmtMs(req.elapsed_ms)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Models + Usage */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>

        {/* Models */}
        <div className="apple-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em' }}>Models</h2>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{models.length} loaded</span>
          </div>
          {models.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
              {aiOffline ? 'Models unavailable while the AI node is offline.' : 'Loading...'}
            </div>
          ) : models.map(m => (
            <div key={m.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 0', borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {m.name === nodeStats?.active_model && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                    flexShrink: 0, boxShadow: '0 0 0 3px var(--accent-dim)',
                  }} />
                )}
                <span style={{
                  fontFamily: 'ui-monospace, monospace', fontSize: 13,
                  color: 'var(--text-primary)', letterSpacing: '-0.01em',
                  paddingLeft: m.name === nodeStats?.active_model ? 0 : 16,
                }}>
                  {m.name}
                </span>
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {(m.size/1e9).toFixed(1)} GB
              </span>
            </div>
          ))}
        </div>

        {/* Usage */}
        <div className="apple-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em' }}>Usage</h2>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {usage?.total_requests ?? '—'} total
            </span>
          </div>
          {!usage || usage.by_model.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 14, paddingTop: 8 }}>
              No requests yet
            </div>
          ) : usage.by_model.slice(0, 6).map((m, i) => {
            const max = usage.by_model[0].total_requests
            return (
              <div key={m.model} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13,
                                 color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                    {m.model}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {m.total_requests} reqs · {fmtMs(m.avg_duration_ms)}
                  </span>
                </div>
                <ProgressBar value={Math.round(m.total_requests / max * 100)} />
              </div>
            )
          })}
        </div>
      </div>

      {usage?.by_app?.length > 0 && (
        <div className="apple-card" style={{ padding: '24px', marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em' }}>Apps Using Gateway</h2>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{usage.by_app.length} clients</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {usage.by_app.slice(0, 6).map(app => (
              <div key={app.app_name} style={{ background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {app.app_name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {app.total_requests} requests · {fmtMs(app.avg_duration_ms)} avg
                  {app.failures ? ` · ${app.failures} failures` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity */}
      <div className="apple-card" style={{ padding: '24px', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em' }}>Activity</h2>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Last 25 · 30s refresh</span>
        </div>
        {activity.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 14, padding: '24px 0', textAlign: 'center' }}>
            No activity yet — requests will appear here when apps connect
          </div>
        ) : activity.map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 0', borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '3px 8px',
              borderRadius: 5, letterSpacing: '0.02em',
              background: a.status_code >= 400 ? 'rgba(255,59,48,0.12)' : a.endpoint === 'chat' ? 'rgba(0,122,255,0.12)' : 'rgba(52,199,89,0.12)',
              color: a.status_code >= 400 ? 'var(--red)' : a.endpoint === 'chat' ? 'var(--blue)' : 'var(--accent-text)',
              fontFamily: 'ui-monospace, monospace', flexShrink: 0,
            }}>
              {a.endpoint}
            </span>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13,
                           color: 'var(--text-primary)', flex: 1, letterSpacing: '-0.01em' }}>
              {a.model}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>{a.app_name}</span>
            <span style={{ fontSize: 12, color: a.status_code >= 400 ? 'var(--red)' : 'var(--text-tertiary)', flexShrink: 0 }}>
              {a.status_code || '-'} · {fmtMs(a.duration_ms)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>
              {fmtShort(a.created_at)}
            </span>
          </div>
        ))}
      </div>

      {/* Live Topology */}
      <div className="apple-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.03em' }}>Live Topology</h2>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Active connections (last 5 min)</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>

          {/* Apps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 150 }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Apps</div>
            {topology.connections.length === 0 ? (
              <div style={{
                background: 'var(--bg-subtle)', borderRadius: 12,
                padding: '12px 16px', fontSize: 13, color: 'var(--text-tertiary)', fontStyle: 'italic',
              }}>
                No active apps
              </div>
            ) : topology.connections.map((c, i) => (
              <TopologyNode key={i} label={c.app_name} sub={c.model} active />
            ))}
          </div>

          <ConnectorLine active={topology.connections.length > 0} />

          {/* Gateway */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>Gateway</div>
            <TopologyNode label="Home Gateway" sub="10.0.0.24" active />
          </div>

          <ConnectorLine active={ollamaOk && !!topology.active_model} />

          {/* AI Node */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 160 }}>
            <div className="apple-label" style={{ marginBottom: 4 }}>AI Node</div>
            <TopologyNode label="austin-ai" sub={ollamaOk ? '10.0.0.8 - Ollama' : 'Offline'} active={ollamaOk} />
            {topology.active_model && (
              <TopologyNode label={topology.active_model} sub="Active model" active />
            )}
          </div>

        </div>
      </div>

      <style>{`
        @keyframes flow {
          0%   { left: -40%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}
