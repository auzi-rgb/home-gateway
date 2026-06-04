export default function ModelTable({ models, activeModel }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">Models</h2>
        <span className="text-xs text-slate-500">{models.length} loaded</span>
      </div>
      {models.length === 0 ? (
        <div className="text-slate-500 text-sm">Loading...</div>
      ) : (
        models.map(m => (
          <div key={m.name} className="flex items-center justify-between py-2 border-b border-slate-700 last:border-0">
            <div className="flex items-center gap-2">
              {m.name === activeModel && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              <span className="text-sm font-mono text-slate-200">{m.name}</span>
            </div>
            <span className="text-xs text-slate-500">{(m.size / 1e9).toFixed(1)} GB</span>
          </div>
        ))
      )}
    </div>
  )
}
