/* ================= CONFIGURATION & STATE ================= */
const LEAGUE_ID = 101712; // Update with your ID
const PROXY_URL = "/.netlify/functions/fpl-proxy";
let lockedPlayer = null;
let previousTransfers = {};

/* ================= DATA ENGINE ================= */
async function fetchFPL(key, path, ttl = 1800000) {
    const cached = localStorage.getItem(key);
    if (cached) {
        const { data, expiry } = JSON.parse(cached);
        if (Date.now() < expiry) return data;
    }
    try {
        const res = await fetch(`${PROXY_URL}?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        if (data && !data.error) {
            localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl }));
        }
        return data;
    } catch (e) { return null; }
}

/* ================= AUTH & NAVIGATION ================= */
if (window.netlifyIdentity) {
    netlifyIdentity.on("init", user => { if (user) showDashboard(); });
    netlifyIdentity.on("login", () => { showDashboard(); netlifyIdentity.close(); });
    netlifyIdentity.on("logout", () => { localStorage.clear(); location.reload(); });
}

function showDashboard() {
    document.getElementById("auth-overlay").style.display = "none";
    document.getElementById("app").style.display = "block";
    loadAllSections();
}

const sideNav = document.getElementById('sideNav');
const navOverlay = document.getElementById('navOverlay');
document.getElementById('menuToggle').onclick = () => { sideNav.classList.add('open'); navOverlay.classList.add('show'); };
document.getElementById('closeNav').onclick = () => { sideNav.classList.remove('open'); navOverlay.classList.remove('show'); };

document.querySelectorAll(".nav-link").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll(".nav-link, .tab-content").forEach(el => el.classList.remove("active", "active-tab"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active-tab");
        sideNav.classList.remove('open'); navOverlay.classList.remove('show');
    };
});

/* ================= APP CORE ================= */
async function loadAllSections() {
    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000);
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`, 300000);
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;

    if (league && bootstrap) {
        renderMembers(league, bootstrap);
        renderLiveBonus(bootstrap);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPlanner(bootstrap);
        checkRivalTransfers(league, currentGW);
    }
}

// 1. Members + Diff Detector
async function renderMembers(league, bootstrap) {
    const el = document.getElementById("members");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {}; bootstrap.elements.forEach(p => playerMap[p.id] = p.web_name);

    const yourEntryId = league.standings.results[0].entry; 
    const yourData = await fetchFPL(`entry_${yourEntryId}_gw${currentGW}`, `entry/${yourEntryId}/event/${currentGW}/picks`);
    const yourPicks = yourData?.picks ? yourData.picks.map(p => p.element) : [];

    let html = `<h2>League War Room</h2><div class="card" style="padding:0; overflow-x:auto;"><table class="fpl-table"><thead><tr><th>Manager</th><th>Diffs</th><th>Captain (Pts)</th><th style="text-align:center;">GW</th><th style="text-align:right;">Total</th></tr></thead><tbody>`;

    for (const m of league.standings.results) {
        const rivalData = await fetchFPL(`entry_${m.entry}_gw${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (!rivalData) continue;
        const rivalPicks = rivalData.picks.map(p => p.element);
        const risks = rivalPicks.filter(id => !yourPicks.includes(id)).slice(0, 2);
        const cap = rivalData.picks.find(p => p.is_captain);
        const capObj = bootstrap.elements.find(e => e.id === cap.element);

        html += `<tr class="league-row">
            <td><div style="font-weight:700;">${m.player_name}</div><div style="font-size:0.75rem; color:var(--fpl-text-muted)">${m.entry_name}</div></td>
            <td><div class="diff-tags">${risks.map(id => `<span class="tag risk">${playerMap[id]}</span>`).join('')}</div></td>
            <td><strong>${capObj.web_name}</strong><br><small style="color:var(--fpl-green)">+${capObj.event_points * cap.multiplier} pts</small></td>
            <td style="text-align:center;"><span class="bonus-pill" style="background:#f1f5f9">${m.event_total}</span></td>
            <td style="text-align:right; font-weight:800; padding-right:15px;">${m.total}</td>
        </tr>`;
    }
    el.innerHTML = html + `</tbody></table></div>`;
}

// 2. Live Bonus Predictor
async function renderLiveBonus(bootstrap) {
    const el = document.getElementById("bonusContainer");
    const liveData = await fetchFPL("fpl_live", "event/current/live", 60000);
    if (!liveData) return;

    const playerMap = {}; bootstrap.elements.forEach(p => playerMap[p.id] = { name: p.web_name, team: p.team });
    const teamMap = {}; bootstrap.teams.forEach(t => teamMap[t.id] = t.short_name);

    const topBPS = liveData.elements.filter(e => e.stats.minutes > 0).sort((a,b) => b.stats.bps - a.stats.bps).slice(0, 10);

    let html = `<h2>Live Bonus Points <span class="badge">Live</span></h2>`;
    topBPS.forEach((p, i) => {
        const projected = i < 3 ? 3 : (i < 6 ? 2 : 1);
        const color = projected === 3 ? 'var(--fpl-green)' : (projected === 2 ? '#9ae6b4' : '#cbd5e0');
        html += `<div class="card flex-between" style="border-left: 5px solid ${color}">
            <div><strong>${playerMap[p.id].name}</strong><br><small>${teamMap[playerMap[p.id].team]} • ${p.stats.bps} BPS</small></div>
            <span class="bonus-pill" style="background:${color}">+${projected} Bonus</span>
        </div>`;
    });
    el.innerHTML = html || "<p>No matches live.</p>";
}

// 3. Rival Watch Alerts
async function checkRivalTransfers(league, currentGW) {
    const top3 = league.standings.results.slice(0, 3);
    for (const m of top3) {
        const data = await fetchFPL(`entry_${m.entry}_gw${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`, 60000);
        const count = data?.entry_history?.event_transfers || 0;
        if (previousTransfers[m.entry] !== undefined && count > previousTransfers[m.entry]) {
            showRivalToast(`${m.player_name} made a transfer!`);
        }
        previousTransfers[m.entry] = count;
    }
}

function showRivalToast(msg) {
    const t = document.createElement("div"); t.className = "rival-toast";
    t.innerHTML = `<div class="toast-header"><span>RIVAL ALERT</span><span onclick="this.parentElement.parentElement.remove()">&times;</span></div><div>${msg}</div>`;
    document.body.appendChild(t); setTimeout(() => t.remove(), 10000);
}

// 4. Effective Ownership, Fixtures, & Planner (Simplified placeholders)
async function renderCommunityXI(l, b) { /* Standard EO logic here */ }
async function renderFixtures(b) { /* Standard Fixture logic here */ }
async function renderPlanner(b) { /* Standard Search/Compare logic here */ }
