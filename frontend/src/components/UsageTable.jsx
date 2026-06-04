export default function UsageTable({ usage }) {
  if (!usage) return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h2 className="font-semibold text-white mb-4">Usage</h2>
      <div className="text-slate-500 text-sm">Loading...</div>
    </div>
  )

  const max = usage.by_model[0]?.total_requests || 1

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">Usage</h2>
        <span className="text-xs text-slate-500">{usage.total_requests} total requests</span>
      </div>
      {usage.by_model.length === 0 ? (
        <div className="text-slate-500 text-sm">No requests yet</div>
      ) : (
        usage.by_model.map(m => (
          <div key={m.model} className="py-2 border-b border-slate-700 last:border-0">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-mono text-slate-200">{m.model}</span>
              <span className="text-xs text-slate-400">{m.total_requests} reqs</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full">
              <div
                className="h-1.5 bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.round((m.total_requests / max) * 100)}%` }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  )
}
