const API = "http://localhost:3000";

// ── State ──────────────────────────────────────────────────────────────────
let accessToken = null;
let atExpiry = null;       // unix timestamp (seconds)
let countdownInterval = null;
let logCount = 0;
let currentTab = "signin";

// ── Logging ────────────────────────────────────────────────────────────────
function log(msg, type = "info") {
    const icons = { info: "→", success: "✓", error: "✗", warn: "⚠", refresh: "↻" };
    const now = new Date().toLocaleTimeString("en-US", { hour12: false });

    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
        <span class="log-arrow">${icons[type] ?? "→"}</span>
        <span class="log-time">${now}</span>
        <span class="log-msg">${msg}</span>
    `;

    const container = document.getElementById("log-entries");
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;

    logCount++;
    document.getElementById("log-count").textContent = `${logCount} events`;
}

export function clearLog() {
    document.getElementById("log-entries").innerHTML = "";
    logCount = 0;
    document.getElementById("log-count").textContent = "0 events";
}

// ── Token UI ───────────────────────────────────────────────────────────────
function setAT(token) {
    accessToken = token;

    if (!token) {
        document.getElementById("at-display").textContent = "—";
        document.getElementById("at-dot").className = "dot gray";
        document.getElementById("at-status").textContent = "none";
        document.getElementById("at-countdown").textContent = "";
        clearInterval(countdownInterval);
        atExpiry = null;
        return;
    }

    // Decode payload (base64 middle part) — no verification, just for display
    const payload = JSON.parse(atob(token.split(".")[1]));
    atExpiry = payload.exp;

    document.getElementById("at-display").textContent = token;
    document.getElementById("at-dot").className = "dot green";
    document.getElementById("at-status").textContent = `valid · user ${payload.sub} (${payload.email})`;

    clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdown, 1000);
    updateCountdown();
}

function updateCountdown() {
    if (!atExpiry) return;
    const secsLeft = atExpiry - Math.floor(Date.now() / 1000);

    if (secsLeft <= 0) {
        document.getElementById("at-dot").className = "dot red";
        document.getElementById("at-status").textContent = "expired";
        document.getElementById("at-countdown").textContent = "AT expired — next request will trigger refresh";
        clearInterval(countdownInterval);
        return;
    }

    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;
    document.getElementById("at-countdown").textContent =
        `Expires in ${mins}m ${String(secs).padStart(2, "0")}s`;

    if (secsLeft < 60) {
        document.getElementById("at-dot").className = "dot yellow";
    }
}

function setRTStatus(active) {
    document.getElementById("rt-dot").className = `dot ${active ? "green" : "gray"}`;
    document.getElementById("rt-status").textContent = active
        ? "active — stored in httpOnly cookie"
        : "cleared";
}

// ── API helpers ────────────────────────────────────────────────────────────

// Low-level fetch — no retry logic
async function apiFetch(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        credentials: "include",   // send cookies (RT) automatically
        headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...options.headers,
        },
        ...options,
    });
    return res;
}

// Refresh the AT using the RT cookie
async function refreshAT() {
    log("AT expired or missing — sending RT cookie to <strong>POST /auth/local/refresh</strong>", "refresh");

    const res = await apiFetch("/auth/local/refresh", { method: "POST" });

    if (!res.ok) {
        log(`Refresh failed (${res.status}) — session ended, please sign in again`, "error");
        setAT(null);
        setRTStatus(false);
        showAuth();
        return false;
    }

    const data = await res.json();
    setAT(data.accessToken);
    log("New AT received — RT rotated in DB and cookie updated", "refresh");
    return true;
}

// Smart fetch: if 401, refresh then retry once
async function smartFetch(path, options = {}) {
    log(`Sending <strong>GET ${path}</strong> with AT in Authorization header`, "info");

    let res = await apiFetch(path, options);

    if (res.status === 401) {
        log(`Got <strong>401 Unauthorized</strong> — AT is expired or invalid`, "error");
        const refreshed = await refreshAT();
        if (!refreshed) return null;

        log(`Retrying <strong>GET ${path}</strong> with new AT`, "info");
        res = await apiFetch(path, options);
    }

    return res;
}

// ── Auth flows ─────────────────────────────────────────────────────────────
export async function handleAuth() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const errorEl = document.getElementById("auth-error");
    errorEl.style.display = "none";

    const endpoint = currentTab === "signin" ? "/auth/local/signin" : "/auth/local/signup";
    const label = currentTab === "signin" ? "Sign in" : "Sign up";

    try {
        const res = await fetch(`${API}${endpoint}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            errorEl.textContent = data.message ?? `${label} failed (${res.status})`;
            errorEl.style.display = "block";
            return;
        }

        const data = await res.json();
        setAT(data.accessToken);
        setRTStatus(true);

        showDashboard(email);
        log(`${label} successful — AT stored in memory, RT stored in httpOnly cookie`, "success");
    } catch {
        errorEl.textContent = "Could not reach server. Is it running?";
        errorEl.style.display = "block";
    }
}

export async function fetchMe() {
    const res = await smartFetch("/auth/me");
    if (!res) return;

    if (res.ok) {
        const data = await res.json();
        log(`<strong>GET /auth/me</strong> → 200 OK · id: ${data.id}, email: ${data.email}`, "success");
    } else {
        log(`<strong>GET /auth/me</strong> → ${res.status}`, "error");
    }
}

export function simulateExpiry() {
    log("Simulating expired AT — clearing token from memory", "warn");
    log("This is what happens after 15 minutes in production", "warn");
    accessToken = null;
    atExpiry = Math.floor(Date.now() / 1000) - 1;   // already expired
    document.getElementById("at-display").textContent = "[ cleared — simulating expiry ]";
    document.getElementById("at-dot").className = "dot red";
    document.getElementById("at-status").textContent = "expired (simulated)";
    document.getElementById("at-countdown").textContent = "Next request will trigger refresh";
    clearInterval(countdownInterval);
    log("Now click <strong>Fetch /auth/me</strong> to see the refresh flow", "warn");
}

export async function handleLogout() {
    log("Sending <strong>POST /auth/local/logout</strong> with AT", "info");

    const res = await apiFetch("/auth/local/logout", { method: "POST" });

    if (res.ok || res.status === 204) {
        log("Logout successful — hashed_rt cleared in DB, cookie cleared", "success");
        setAT(null);
        setRTStatus(false);

        log("RT cookie is now gone — refresh will return 401", "warn");
        showAuth();
    } else {
        log(`Logout failed (${res.status})`, "error");
    }
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function showDashboard(email) {
    document.getElementById("auth-screen").style.display = "none";
    const dash = document.getElementById("dashboard");
    dash.style.display = "flex";

    const initial = email.charAt(0).toUpperCase();
    document.getElementById("avatar").textContent = initial;
    document.getElementById("user-email").textContent = email;
    document.getElementById("user-id").textContent = "authenticated";
}

function showAuth() {
    document.getElementById("dashboard").style.display = "none";
    document.getElementById("auth-screen").style.display = "block";
    document.getElementById("password").value = "";
}

export function switchTab(tab) {
    currentTab = tab;
    document.getElementById("tab-signin").classList.toggle("active", tab === "signin");
    document.getElementById("tab-signup").classList.toggle("active", tab === "signup");
    document.getElementById("auth-btn").textContent = tab === "signin" ? "Sign In" : "Sign Up";
    document.getElementById("auth-error").style.display = "none";
}

// Expose to inline onclick handlers
window.handleAuth = handleAuth;
window.fetchMe = fetchMe;
window.simulateExpiry = simulateExpiry;
window.handleLogout = handleLogout;
window.switchTab = switchTab;
window.clearLog = clearLog;
