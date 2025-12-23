/* ================= CONFIGURATION & STATE ================= */
const LEAGUE_ID = 101712; 
const PROXY_URL = "/.netlify/functions/fpl-proxy";
let lockedPlayer = null;
let previousTransfers = {};

/* ================= DATA ENGINE (WITH CACHING) ================= */
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

// Sidebar Controls
const sideNav = document.getElementById('sideNav');
const navOverlay = document.getElementById('navOverlay');
document.getElementById('menuToggle').onclick = () => { sideNav.classList.add('open'); navOverlay.classList.add('show'); };
document.getElementById('closeNav').onclick = () => { sideNav.classList.remove('open'); navOverlay.classList.remove('show'); };
navOverlay.onclick = () => { sideNav.classList.remove('open'); navOverlay.classList.remove('show'); };

document.querySelectorAll(".nav-link").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll(".nav-link, .tab-content").forEach(el => el.classList.remove("active", "active-tab"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active-tab");
        sideNav.classList.remove('open'); navOverlay.classList.remove('show');
    };
});

/* ================= TAB RENDERERS ================= */
async function loadAllSections() {
    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000);
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`, 300000);
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;

    if (league && bootstrap) {
        renderMembers(league, bootstrap);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPlanner(bootstrap);
        checkRivalTransfers(league, currentGW);
    }
}

// 1. MEMBERS (Live Standings + Diff Detector + Captain Tracking)
async function renderMembers(league, bootstrap) {
    const el = document.getElementById("members");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {};
    bootstrap.elements.forEach(p => playerMap[p.id] = p.web_name);

    // Baseline: Use League Leader as 'Your Team' for Diff Detector demo
    const yourEntryId = league.standings.results[0].entry; 
    const yourData = await fetchFPL(`entry_${yourEntryId}_gw${currentGW}`, `entry/${yourEntryId}/event/${currentGW}/picks`);
    const yourPicks = yourData?.picks ? yourData.picks.map(p => p.element) : [];

    el.innerHTML = `<h2>League War Room <span class="badge">Live</span></h2>
        <div class="card" style="padding:0; overflow-x:auto;">
            <table class="fpl-table">
                <thead><tr>
                    <th>Manager</th>
                    <th>Diffs (Risks)</th>
                    <th>Captain (Pts)</th>
                    <th style="text-align:center;">GW</th>
                    <th style="text-align:right;">Total</th>
                </tr></thead>
                <tbody id="standingsBody"></tbody>
            </table>
        </div>`;

    const standingsBody = document.getElementById("standingsBody");
    for (const m of league.standings.results) {
        const rivalData = await fetchFPL(`entry_${m.entry}_gw${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (!rivalData) continue;

        const rivalPicks = rivalData.picks.map(p => p.element);
        const risks = rivalPicks.filter(id => !yourPicks.includes(id)).slice(0, 2);
        const captainPick = rivalData.picks.find(p => p.is_captain);
        const captainObj = bootstrap.elements.find(e => e.id === captainPick.element);
        const captainPoints = (captainObj.event_points * captainPick.multiplier);

        standingsBody.innerHTML += `
            <tr class="league-row">
                <td><div class="manager-name">${m.player_name}</div><div class="team-name">${m.entry_name}</div></td>
                <td><div class="diff-tags">${risks.map(id => `<span class="tag risk">${playerMap[id]}</span>`).join('')}</div></td>
                <td>
                    <div style="font-weight:700;">${captainObj.web_name}</div>
                    <div style="font-size:0.75rem; color:var(--fpl-green)">+${captainPoints} pts</div>
                </td>
                <td style="text-align:center;"><span class="gw-pts-pill">${m.event_total}</span></td>
                <td style="text-align:right; font-weight:800; padding-right:15px;">${m.total}</td>
            </tr>`;
    }
}

// 2. EFFECTIVE OWNERSHIP (EO)
async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {}; bootstrap.elements.forEach(p => playerMap[p.id] = p.web_name);
    
    const counts = {}; const caps = {};
    const topManagers = league.standings.results.slice(0, 10);

    for (const m of topManagers) {
        const picks = await fetchFPL(`picks_${m.entry}_${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (picks?.picks) picks.picks.forEach(p => {
            counts[p.element] = (counts[p.element] || 0) + 1;
            if (p.is_captain) caps[p.element] = (caps[p.element] || 0) + 1;
        });
    }

    const eoData = Object.keys(counts).map(id => ({
        id, eo: ((counts[id] + (caps[id] || 0)) / topManagers.length) * 100
    })).sort((a,b) => b.eo - a.eo).slice(0, 10);

    el.innerHTML = `<h2>Effective Ownership</h2>` + eoData.map(item => `
        <div class="card">
            <div class="flex-between"><strong>${playerMap[item.id]}</strong><span class="eo-badge" style="background:${item.eo > 100 ? 'var(--fpl-pink)' : 'var(--fpl-green)'}">${item.eo.toFixed(0)}% EO</span></div>
            <div class="eo-bar-bg"><div class="eo-bar-fill" style="width:${Math.min(item.eo, 100)}%; background:${item.eo > 100 ? 'var(--fpl-pink)' : 'var(--fpl-green)'}"></div></div>
        </div>`).join("");
}

// 3. RIVAL WATCH NOTIFICATIONS (Top 3 Managers)
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
    t.innerHTML = `<div class="toast-header"><span>RIVAL WATCH</span><span onclick="this.parentElement.parentElement.remove()">&times;</span></div><div>${msg}</div>`;
    document.body.appendChild(t); setTimeout(() => t.remove(), 8000);
}

// 4. FIXTURE TICKER
async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teams = {}; bootstrap.teams.forEach(t => teams[t.id] = t.short_name);
    el.innerHTML = "<h2>Fixture Ticker</h2>" + fixtures.slice(0, 10).map(f => `
        <div class="card flex-between"><span><strong>${teams[f.team_h]}</strong> v ${teams[f.team_a]}</span><span class="diff-chip" style="background:${f.team_h_difficulty <= 2 ? 'var(--fpl-green)' : (f.team_h_difficulty >= 4 ? 'var(--fpl-pink)' : '#cbd5e0')}">GW${f.event}</span></div>`).join("");
}

// 5. SCOUT TOOL & COMPARISON
function renderPlanner(bootstrap) {
    const el = document.getElementById("transfers");
    el.innerHTML = `<h2>Scout Tool</h2><div class="card"><input type="text" id="playerSearch" class="fpl-input" placeholder="Search Player..."><div id="plannerOutput"></div></div>`;
    document.getElementById("playerSearch").oninput = (e) => {
        const query = e.target.value.toLowerCase(); if (query.length < 3) return;
        const p = bootstrap.elements.find(p => p.web_name.toLowerCase().includes(query));
        if (p) {
            document.getElementById("plannerOutput").innerHTML = `
                <div class="scout-result-animated" style="margin-top:15px; border-top:1px solid #eee; padding-top:15px;">
                    <div class="flex-between"><div><h3>${p.web_name}</h3><small>£${(p.now_cost/10).toFixed(1)}m</small></div><button class="secondary-btn" onclick="lockPlayer(${p.id})">${lockedPlayer ? 'Compare' : 'Set A'}</button></div>
                    <div class="stat-row-mini"><span>xG: ${p.expected_goals}</span><span>xA: ${p.expected_assists}</span><span>Points: ${p.total_points}</span></div>
                </div>`;
        }
    };
}

window.lockPlayer = function(id) {
    const b = JSON.parse(localStorage.getItem("fpl_bootstrap")).data;
    const p = b.elements.find(x => x.id === id);
    if (!lockedPlayer) { lockedPlayer = p; renderPlanner(b); }
    else { showComparisonModal(lockedPlayer, p, b); lockedPlayer = null; renderPlanner(b); }
};

function showComparisonModal(pA, pB, b) {
    document.body.insertAdjacentHTML('beforeend', `<div class="comparison-overlay"><div class="comparison-modal"><div class="flex-between"><h2>Compare</h2><span style="font-size:2rem; cursor:pointer;" onclick="this.parentElement.parentElement.parentElement.remove()">&times;</span></div><table class="comparison-table"><thead><tr><th>Metric</th><th>${pA.web_name}</th><th>${pB.web_name}</th></tr></thead><tbody><tr><td>Price</td><td>£${(pA.now_cost/10).toFixed(1)}m</td><td>£${(pB.now_cost/10).toFixed(1)}m</td></tr><tr><td>xG</td><td class="${pA.expected_goals > pB.expected_goals ? 'winner':''}">${pA.expected_goals}</td><td class="${pB.expected_goals > pA.expected_goals ? 'winner':''}">${pB.expected_goals}</td></tr><tr><td>Points</td><td class="${pA.total_points > pB.total_points ? 'winner':''}">${pA.total_points}</td><td class="${pB.total_points > pA.total_points ? 'winner':''}">${pB.total_points}</td></tr></tbody></table></div></div>`);
}
