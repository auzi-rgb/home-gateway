export default function StatCard({ label, value, sub, color, bar }) {
  return (
    <div style={{
      background: 'var(--bg-card)', backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)', borderRadius: 16,
      boxShadow: 'var(--shadow-card)', padding: '20px 24px',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.04em',
                    color: 'var(--text-primary)', lineHeight: 1.1, marginBottom: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  )
}
