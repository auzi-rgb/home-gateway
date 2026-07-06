from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import sqlite3
import os
import shutil
import asyncio
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

app = FastAPI(title="Home AI Gateway API")

OLLAMA_CONCURRENCY = int(os.getenv("OLLAMA_CONCURRENCY", "2"))
OLLAMA_MAX_QUEUE   = int(os.getenv("OLLAMA_MAX_QUEUE", "4"))

_semaphore: asyncio.Semaphore | None = None
_active_count = 0
_queue_depth  = 0
_active_requests = {}

def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(OLLAMA_CONCURRENCY)
    return _semaphore

async def _acquire_slot() -> int:
    """Acquire a queue slot, raising 429 if the wait queue is full."""
    global _active_count, _queue_depth
    sem = _get_semaphore()
    if _queue_depth >= OLLAMA_MAX_QUEUE:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Too many requests",
                "queue": {
                    "active": _active_count,
                    "waiting": _queue_depth,
                    "concurrency_limit": OLLAMA_CONCURRENCY,
                    "queue_limit": OLLAMA_MAX_QUEUE,
                },
            },
        )
    queued_at = time.perf_counter()
    _queue_depth += 1
    try:
        await sem.acquire()
    except Exception:
        _queue_depth -= 1
        raise
    _queue_depth -= 1
    _active_count += 1
    return int((time.perf_counter() - queued_at) * 1000)

def _release_slot() -> None:
    global _active_count
    _active_count -= 1
    _get_semaphore().release()

@asynccontextmanager
async def ollama_queue_slot():
    wait_ms = await _acquire_slot()
    try:
        yield wait_ms
    finally:
        _release_slot()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://10.0.0.8:11434")
STATS_AGENT = os.getenv("STATS_AGENT", "http://10.0.0.8:11435")
REQUEST_TIMEOUT = 300.0
DB_PATH = os.path.join(os.path.dirname(__file__), "gateway.db")
PROJECTS_DIR = os.path.join(os.path.dirname(__file__), "..", "projects")

os.makedirs(PROJECTS_DIR, exist_ok=True)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS request_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            app_name TEXT NOT NULL DEFAULT 'Gateway',
            status_code INTEGER,
            duration_ms INTEGER,
            wait_ms INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            uploaded_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id)
        );
    """)
    migrations = [
        "ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE request_log ADD COLUMN app_name TEXT NOT NULL DEFAULT 'Gateway'",
        "ALTER TABLE request_log ADD COLUMN status_code INTEGER",
        "ALTER TABLE request_log ADD COLUMN duration_ms INTEGER",
        "ALTER TABLE request_log ADD COLUMN wait_ms INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE request_log ADD COLUMN error TEXT",
    ]
    for sql in migrations:
        try:
            conn.execute(sql)
            conn.commit()
        except Exception:
            pass
    conn.commit()
    conn.close()

init_db()

def log_request(
    model: str,
    endpoint: str,
    app_name: str = "Gateway",
    status_code: int | None = None,
    duration_ms: int | None = None,
    wait_ms: int = 0,
    error: str | None = None,
):
    conn = get_db()
    conn.execute(
        """
        INSERT INTO request_log
            (model, endpoint, app_name, status_code, duration_ms, wait_ms, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            model,
            endpoint,
            app_name,
            status_code,
            duration_ms,
            wait_ms,
            error,
            datetime.now().isoformat(timespec="seconds"),
        )
    )
    conn.commit()
    conn.close()

def queue_snapshot():
    return {
        "active": _active_count,
        "waiting": _queue_depth,
        "concurrency_limit": OLLAMA_CONCURRENCY,
        "queue_limit": OLLAMA_MAX_QUEUE,
        "available_slots": max(OLLAMA_CONCURRENCY - _active_count, 0),
        "is_full": _queue_depth >= OLLAMA_MAX_QUEUE,
    }

def begin_active_request(endpoint: str, body: dict, app_name: str, wait_ms: int) -> str:
    request_id = uuid.uuid4().hex[:10]
    _active_requests[request_id] = {
        "id": request_id,
        "endpoint": endpoint,
        "model": body.get("model", "unknown"),
        "app_name": app_name,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "wait_ms": wait_ms,
        "stream": bool(body.get("stream", True)),
    }
    return request_id

def finish_active_request(request_id: str):
    _active_requests.pop(request_id, None)

def active_requests_snapshot():
    now = time.time()
    result = []
    for req in _active_requests.values():
        started = datetime.fromisoformat(req["started_at"]).timestamp()
        result.append({**req, "elapsed_ms": int((now - started) * 1000)})
    return sorted(result, key=lambda r: r["started_at"])

def recent_request_stats(limit: int = 25):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT model, endpoint, app_name, status_code, duration_ms, wait_ms, error, created_at
        FROM request_log
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) as c FROM request_log").fetchone()["c"]
    conn.close()
    recent = [dict(r) for r in rows]
    completed = [r for r in recent if r.get("duration_ms") is not None]
    failures = [r for r in recent if r.get("status_code") and r["status_code"] >= 400]
    avg_duration = None
    avg_wait = None
    if completed:
        avg_duration = round(sum(r["duration_ms"] for r in completed) / len(completed))
        avg_wait = round(sum(r.get("wait_ms") or 0 for r in completed) / len(completed))
    return {
        "total_requests": total,
        "recent": recent,
        "recent_count": len(recent),
        "recent_failures": len(failures),
        "avg_duration_ms": avg_duration,
        "avg_wait_ms": avg_wait,
    }

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(OLLAMA_HOST)
            ollama_ok = r.status_code == 200
    except Exception:
        ollama_ok = False
    return {
        "gateway": "ok",
        "ollama": "ok" if ollama_ok else "unreachable",
        "queue": queue_snapshot(),
    }

@app.get("/api/gateway/status")
async def gateway_status():
    ollama_ok = False
    active_model = None
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(OLLAMA_HOST)
            ollama_ok = r.status_code == 200
            ps = await client.get(f"{OLLAMA_HOST}/api/ps")
            active_models = ps.json().get("models", [])
            if active_models:
                active_model = active_models[0].get("name")
    except Exception:
        pass

    return {
        "gateway": "ok",
        "ollama": "ok" if ollama_ok else "unreachable",
        "active_model": active_model,
        "queue": queue_snapshot(),
        "active_requests": active_requests_snapshot(),
        "requests": recent_request_stats(),
        "refreshed_at": datetime.now().isoformat(timespec="seconds"),
    }

# ── Node stats (active model + CPU/RAM only when model running) ───────────────

@app.get("/api/node-stats")
async def node_stats():
    result = {"active_model": None, "active_model_size_gb": 0,
              "cpu_percent": None, "ram_used_gb": None, "ram_total_gb": None, "ram_percent": None}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            # Check what's loaded in Ollama
            r = await client.get(f"{OLLAMA_HOST}/api/ps")
            data = r.json()
            models = data.get("models", [])
            if models:
                result["active_model"] = models[0].get("name")
                result["active_model_size_gb"] = round(models[0].get("size", 0) / 1e9, 1)
                # Only fetch Mac stats if something is running
                try:
                    r2 = await client.get(f"{STATS_AGENT}/stats")
                    stats = r2.json()
                    result["cpu_percent"] = stats.get("cpu_percent")
                    result["ram_used_gb"] = stats.get("ram_used_gb")
                    result["ram_total_gb"] = stats.get("ram_total_gb")
                    result["ram_percent"] = stats.get("ram_percent")
                except Exception:
                    pass
    except Exception:
        pass
    return result

# ── Models ────────────────────────────────────────────────────────────────────

@app.get("/api/models")
async def models():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

# ── Generate ──────────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate(request: Request):
    body = await request.json()
    app_name = request.headers.get("X-App-Name", "Gateway")
    model = body.get("model", "unknown")
    if body.get("stream", True):
        wait_ms = await _acquire_slot()
        request_id = begin_active_request("generate", body, app_name, wait_ms)
        started = time.perf_counter()
        status_code = 200
        error = None
        async def streamer():
            nonlocal status_code, error
            try:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                    async with client.stream("POST", f"{OLLAMA_HOST}/api/generate", json=body) as r:
                        status_code = r.status_code
                        async for chunk in r.aiter_bytes():
                            yield chunk
            except Exception as e:
                status_code = 502
                error = str(e)
                raise
            finally:
                duration_ms = int((time.perf_counter() - started) * 1000)
                log_request(model, "generate", app_name, status_code, duration_ms, wait_ms, error)
                finish_active_request(request_id)
                _release_slot()
        return StreamingResponse(streamer(), media_type="application/x-ndjson")
    async with ollama_queue_slot() as wait_ms:
        request_id = begin_active_request("generate", body, app_name, wait_ms)
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                r = await client.post(f"{OLLAMA_HOST}/api/generate", json=body)
                duration_ms = int((time.perf_counter() - started) * 1000)
                log_request(model, "generate", app_name, r.status_code, duration_ms, wait_ms)
                return JSONResponse(content=r.json(), status_code=r.status_code)
        except Exception as e:
            duration_ms = int((time.perf_counter() - started) * 1000)
            log_request(model, "generate", app_name, 502, duration_ms, wait_ms, str(e))
            raise HTTPException(status_code=502, detail=str(e))
        finally:
            finish_active_request(request_id)

# ── Chat ──────────────────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    app_name = request.headers.get("X-App-Name", "Gateway")
    model = body.get("model", "unknown")
    if body.get("stream", True):
        wait_ms = await _acquire_slot()
        request_id = begin_active_request("chat", body, app_name, wait_ms)
        started = time.perf_counter()
        status_code = 200
        error = None
        async def streamer():
            nonlocal status_code, error
            try:
                async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                    async with client.stream("POST", f"{OLLAMA_HOST}/api/chat", json=body) as r:
                        status_code = r.status_code
                        async for chunk in r.aiter_bytes():
                            yield chunk
            except Exception as e:
                status_code = 502
                error = str(e)
                raise
            finally:
                duration_ms = int((time.perf_counter() - started) * 1000)
                log_request(model, "chat", app_name, status_code, duration_ms, wait_ms, error)
                finish_active_request(request_id)
                _release_slot()
        return StreamingResponse(streamer(), media_type="application/x-ndjson")
    async with ollama_queue_slot() as wait_ms:
        request_id = begin_active_request("chat", body, app_name, wait_ms)
        started = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                r = await client.post(f"{OLLAMA_HOST}/api/chat", json=body)
                duration_ms = int((time.perf_counter() - started) * 1000)
                log_request(model, "chat", app_name, r.status_code, duration_ms, wait_ms)
                return JSONResponse(content=r.json(), status_code=r.status_code)
        except Exception as e:
            duration_ms = int((time.perf_counter() - started) * 1000)
            log_request(model, "chat", app_name, 502, duration_ms, wait_ms, str(e))
            raise HTTPException(status_code=502, detail=str(e))
        finally:
            finish_active_request(request_id)

# ── Usage ─────────────────────────────────────────────────────────────────────

@app.get("/api/usage")
async def usage():
    conn = get_db()
    by_model = conn.execute("""
        SELECT
            model,
            COUNT(*) as total_requests,
            MAX(created_at) as last_used,
            ROUND(AVG(duration_ms)) as avg_duration_ms,
            ROUND(AVG(wait_ms)) as avg_wait_ms,
            SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failures
        FROM request_log GROUP BY model ORDER BY total_requests DESC
    """).fetchall()
    by_app = conn.execute("""
        SELECT
            app_name,
            COUNT(*) as total_requests,
            MAX(created_at) as last_used,
            ROUND(AVG(duration_ms)) as avg_duration_ms,
            SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failures
        FROM request_log GROUP BY app_name ORDER BY total_requests DESC
    """).fetchall()
    total = conn.execute("SELECT COUNT(*) as c FROM request_log").fetchone()["c"]
    conn.close()
    return {
        "total_requests": total,
        "by_model": [dict(r) for r in by_model],
        "by_app": [dict(r) for r in by_app],
    }

# ── Projects ──────────────────────────────────────────────────────────────────

@app.get("/api/projects")
async def list_projects():
    conn = get_db()
    projects = conn.execute("SELECT * FROM projects ORDER BY created_at DESC").fetchall()
    result = []
    for p in projects:
        files = conn.execute(
            "SELECT id, filename, uploaded_at FROM project_files WHERE project_id=? ORDER BY uploaded_at DESC",
            (p["id"],)
        ).fetchall()
        result.append({**dict(p), "files": [dict(f) for f in files]})
    conn.close()
    return result

@app.post("/api/projects")
async def create_project(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    now = datetime.now().isoformat()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO projects (name, notes, created_at) VALUES (?, '', ?)", (name, now)
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    os.makedirs(os.path.join(PROJECTS_DIR, str(pid)), exist_ok=True)
    return {"id": pid, "name": name, "notes": "", "created_at": now, "files": []}

@app.put("/api/projects/{project_id}/notes")
async def update_notes(project_id: int, request: Request):
    body = await request.json()
    notes = body.get("notes", "")
    conn = get_db()
    conn.execute("UPDATE projects SET notes=? WHERE id=?", (notes, project_id))
    conn.commit()
    conn.close()
    return {"updated": project_id}

@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int):
    project_dir = os.path.join(PROJECTS_DIR, str(project_id))
    if os.path.exists(project_dir):
        shutil.rmtree(project_dir)
    conn = get_db()
    conn.execute("DELETE FROM project_files WHERE project_id=?", (project_id,))
    conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
    conn.commit()
    conn.close()
    return {"deleted": project_id}

# ── Project files ─────────────────────────────────────────────────────────────

@app.post("/api/projects/{project_id}/files")
async def upload_file(project_id: int, file: UploadFile = File(...)):
    conn = get_db()
    project = conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
    conn.close()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project_dir = os.path.join(PROJECTS_DIR, str(project_id))
    os.makedirs(project_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_filename = f"{timestamp}_{file.filename}"
    filepath = os.path.join(project_dir, safe_filename)
    contents = await file.read()
    with open(filepath, "wb") as f:
        f.write(contents)
    now = datetime.now().isoformat()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO project_files (project_id, filename, filepath, uploaded_at) VALUES (?, ?, ?, ?)",
        (project_id, file.filename, filepath, now)
    )
    conn.commit()
    fid = cur.lastrowid
    conn.close()
    return {"id": fid, "filename": file.filename, "uploaded_at": now}

@app.get("/api/projects/{project_id}/files/{file_id}/download")
async def download_file(project_id: int, file_id: int):
    conn = get_db()
    f = conn.execute(
        "SELECT * FROM project_files WHERE id=? AND project_id=?", (file_id, project_id)
    ).fetchone()
    conn.close()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(f["filepath"]):
        raise HTTPException(status_code=404, detail="File missing from disk")
    return FileResponse(path=f["filepath"], filename=f["filename"], media_type="text/markdown")

@app.delete("/api/projects/{project_id}/files/{file_id}")
async def delete_file(project_id: int, file_id: int):
    conn = get_db()
    f = conn.execute(
        "SELECT * FROM project_files WHERE id=? AND project_id=?", (file_id, project_id)
    ).fetchone()
    if f and os.path.exists(f["filepath"]):
        os.remove(f["filepath"])
    conn.execute("DELETE FROM project_files WHERE id=? AND project_id=?", (file_id, project_id))
    conn.commit()
    conn.close()
    return {"deleted": file_id}

# ── Snapshot ──────────────────────────────────────────────────────────────────

@app.get("/api/snapshot")
async def snapshot():
    models_list = []
    node = {}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            models_list = r.json().get("models", [])
            r2 = await client.get(f"{STATS_AGENT}/stats")
            node = r2.json()
    except Exception:
        pass
    model_lines = "\n".join([f"- {m['name']} ({round(m['size']/1e9,1)} GB)" for m in models_list])
    doc = f"""# Home Lab Context Export
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}

## App Server (10.0.0.24)
- OS: Ubuntu 24.04 LTS
- Hostname: home-app-server
- Role: nginx gateway, FastAPI API, React frontend
- Stack: FastAPI + React/Vite + SQLite + Tailwind CSS
- Services: nginx (port 80), home-gateway backend (port 8000)
- Project files: ~/home-gateway/projects/

## AI Node — austin-ai (10.0.0.8)
- Hardware: MacBook Pro 2019, i9, 64GB RAM
- OS: macOS (headless appliance)
- Ollama port: 11434 · Stats agent port: 11435
- Active model: {node.get('active_model') or 'None'}

## Available Models
{model_lines}

## Gateway Routes (nginx)
- /gateway/        — React frontend
- /gateway/api/*   — FastAPI backend
- /ollama/         — direct Ollama proxy

## Deploy Command
cd ~/home-gateway/frontend && npm run build && sudo cp -r dist/. /var/www/gateway/

## Notes
- bcrypt pinned to 4.0.1 for all auth work
- Preferred command pattern: cat > /tmp/script.py << 'EOF' then python3
- Full nginx rewrites via: sudo bash << 'BASHEOF'
"""
    return {"content": doc}


@app.get("/api/projects/{project_id}/files/{file_id}/content")
async def read_file(project_id: int, file_id: int):
    conn = get_db()
    f = conn.execute(
        "SELECT * FROM project_files WHERE id=? AND project_id=?", (file_id, project_id)
    ).fetchone()
    conn.close()
    if not f:
        raise HTTPException(status_code=404, detail="File not found")
    if not os.path.exists(f["filepath"]):
        raise HTTPException(status_code=404, detail="File missing from disk")
    with open(f["filepath"], "r", encoding="utf-8") as fh:
        content = fh.read()
    return {"filename": f["filename"], "content": content, "uploaded_at": f["uploaded_at"]}


import subprocess

def run(cmd):
    try:
        return subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL, timeout=5).decode().strip()
    except Exception:
        return 'N/A'

@app.get("/api/snapshot/live")
async def live_snapshot():
    hostname     = run("hostname")
    os_info      = run("lsb_release -ds")
    uptime       = run("uptime -p")
    disk         = run("df -h / | tail -1")
    python_ver   = run("python3 --version")
    node_ver     = run("node --version")
    npm_ver      = run("npm --version")
    git_ver      = run("git --version")
    docker_ver   = run("docker --version | cut -d',' -f1")
    services_raw = run("systemctl list-units --type=service --state=running --no-pager --no-legend | awk '{print $1}' | grep -v '@' | head -30")
    services     = [s for s in services_raw.splitlines() if any(x in s for x in ['nginx','gateway','docker','ssh','project','eval','resume'])]
    nginx_conf   = run("cat /etc/nginx/sites-enabled/default | grep -E 'location|proxy_pass|root' | sed 's/^[ \t]*//'")
    project_dirs = run("find /home/austin -maxdepth 2 -name '.git' -type d 2>/dev/null | head -10")
    git_remotes  = []
    for d in project_dirs.splitlines():
        repo_dir = d.replace('/.git', '')
        remote = run(f"git -C {repo_dir} remote get-url origin 2>/dev/null")
        if remote and remote != 'N/A':
            git_remotes.append(f"- {repo_dir.split('/')[-1]}: {remote}")

    models_list  = []
    active_model = None
    node_stats   = {}
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/tags")
            models_list = r.json().get("models", [])
            r2 = await client.get(f"{OLLAMA_HOST}/api/ps")
            ps = r2.json().get("models", [])
            if ps:
                active_model = ps[0].get("name")
            r3 = await client.get(f"{STATS_AGENT}/stats")
            node_stats = r3.json()
    except Exception:
        pass

    model_lines   = "\n".join([f"- {m['name']} ({round(m['size']/1e9,1)} GB)" for m in models_list])
    service_lines = "\n".join([f"- {s}" for s in services]) if services else "- (none detected)"
    remote_lines  = "\n".join(git_remotes) if git_remotes else "- (none detected)"
    now = datetime.now().strftime('%Y-%m-%d %H:%M')

    doc = f"""# Home Lab Context Export
Generated: {now}

---

## App Server

| Property | Value |
|----------|-------|
| Hostname | {hostname} |
| IP | 10.0.0.24 |
| OS | {os_info} |
| Uptime | {uptime} |
| Disk | {disk} |

### Installed Software

| Tool | Version |
|------|---------|
| Python | {python_ver} |
| Node.js | {node_ver} |
| npm | {npm_ver} |
| Git | {git_ver} |
| Docker | {docker_ver} |

### Running Services
{service_lines}

### nginx Routes
{nginx_conf}

### GitHub Repositories
{remote_lines}

---

## AI Node - austin-ai

| Property | Value |
|----------|-------|
| Hostname | austin-ai |
| IP | 10.0.0.8 |
| Hardware | MacBook Pro 2019, i9, 64GB RAM |
| OS | macOS (headless appliance) |
| Ollama port | 11434 |
| Stats agent port | 11435 |
| Active model | {active_model or 'None'} |
| RAM used | {node_stats.get('ram_used_gb', 'N/A')} / {node_stats.get('ram_total_gb', 'N/A')} GB |

### Available Models
{model_lines}

---

## Gateway

### Routes
- https://10.0.0.24/gateway/ - React frontend (Home AI Gateway)
- https://10.0.0.24/gateway/api/* - FastAPI backend (port 8000)
- https://10.0.0.24/ollama/ - Direct Ollama proxy

### Deploy Command
cd ~/home-gateway/frontend && npm run build && sudo cp -r dist/. /var/www/gateway/

---

## Development Conventions

### Preferred Stack
- Backend: FastAPI + uvicorn + SQLite
- Frontend: React + Vite + Tailwind CSS
- Auth: JWT + bcrypt (bcrypt pinned to 4.0.1 - do not upgrade)
- Reverse proxy: nginx with HTTP/2 + TLS

### Command Patterns
Write files:
  cat > ~/path/to/file.py << 'EOF'
  ...content...
  EOF

nginx config rewrites:
  sudo bash << 'BASHEOF'
  cat > /etc/nginx/sites-enabled/default << 'EOF'
  ...
  EOF
  BASHEOF
  sudo nginx -t && sudo systemctl reload nginx

Python packages:
  sudo pip3 install package-name --break-system-packages

### Port Conventions
| Port | Service |
|------|---------|
| 80 | nginx (redirects to 443) |
| 443 | nginx HTTPS/HTTP2 |
| 8000 | Home Gateway FastAPI |
| 11434 | Ollama (on AI node) |
| 11435 | Stats agent (on AI node) |

### Notes
- SSL: self-signed cert at /etc/nginx/ssl/
- All apps served under nginx at https://10.0.0.24/app-name/
- New apps: add location /app-name/ block to nginx config
- GitHub user: auzi-rgb - SSH key configured on server
"""
    return {"content": doc, "generated_at": now}


@app.get("/api/activity")
async def activity():
    conn = get_db()
    rows = conn.execute("""
        SELECT model, endpoint, app_name, status_code, duration_ms, wait_ms, error, created_at
        FROM request_log
        ORDER BY id DESC
        LIMIT 25
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/topology")
async def topology():
    # Active apps = any app that made a request in the last 5 minutes
    conn = get_db()
    rows = conn.execute("""
        SELECT app_name, model, MAX(created_at) as last_seen
        FROM request_log
        WHERE datetime(replace(created_at, 'T', ' ')) >= datetime('now', '-5 minutes')
        GROUP BY app_name, model
        ORDER BY last_seen DESC
    """).fetchall()
    conn.close()

    active_model = None
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{OLLAMA_HOST}/api/ps")
            ps = r.json().get("models", [])
            if ps:
                active_model = ps[0].get("name")
    except Exception:
        pass

    return {
        "active_model": active_model,
        "connections": [dict(r) for r in rows]
    }
