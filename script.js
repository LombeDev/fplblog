/* ================= CONFIGURATION & STATE ================= */
const LEAGUE_ID = 101712; // Replace with your actual League ID
const PROXY_URL = "/.netlify/functions/fpl-proxy";
let lockedPlayer = null;

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
    } catch (e) { 
        console.error("FPL Fetch Error:", e);
        return null; 
    }
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

// Sidebar/Hamburger Logic
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
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`, 300000); // 5 min cache for standings

    if (league && bootstrap) {
        renderMembers(league);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPlanner(bootstrap);
    }
}

// 1. Members (Detailed Mini-League Standings)
function renderMembers(league) {
    const el = document.getElementById("members");
    el.innerHTML = `
        <h2>${league.league.name} <span class="badge">Live</span></h2>
        <div class="card" style="padding:0; overflow:hidden;">
            <table class="fpl-table">
                <thead>
                    <tr>
                        <th style="padding-left:15px; width:60px;">Pos</th>
                        <th>Manager</th>
                        <th style="text-align:center;">GW</th>
                        <th style="text-align:right; padding-right:15px;">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${league.standings.results.map(m => {
                        const move = m.last_rank - m.rank;
                        const moveClass = move > 0 ? 'up' : (move < 0 ? 'down' : 'steady');
                        const moveIcon = move > 0 ? '▲' : (move < 0 ? '▼' : '—');
                        return `
                        <tr class="league-row">
                            <td style="padding-left:15px; text-align:center;">
                                <div class="rank-num">${m.rank}</div>
                                <div class="movement ${moveClass}">${moveIcon} ${Math.abs(move) || ''}</div>
                            </td>
                            <td>
                                <div class="manager-name">${m.player_name}</div>
                                <div class="team-name">${m.entry_name}</div>
                            </td>
                            <td style="text-align:center; font-weight:600;">${m.event_total}</td>
                            <td style="text-align:right; padding-right:15px; font-weight:800; color:var(--fpl-navy);">
                                ${m.total}
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

// 2. Consensus XI (Top Managers Picks)
async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {}; bootstrap.elements.forEach(p => playerMap[p.id] = p.web_name);
    
    const counts = {};
    const top5 = league.standings.results.slice(0, 5);
    for (const m of top5) {
        const picks = await fetchFPL(`picks_${m.entry}_${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (picks?.picks) picks.picks.forEach(p => counts[p.element] = (counts[p.element] || 0) + 1);
    }

    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 11);
    el.innerHTML = "<h2>Consensus XI</h2>" + sorted.map(([id, count]) => `
        <div class="card flex-between">
            <span>${playerMap[id]}</span>
            <span class="txt-green">${(count/5)*100}% Ownership</span>
        </div>`).join("");
}

// 3. Fixture Ticker
async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teams = {}; bootstrap.teams.forEach(t => teams[t.id] = t.short_name);
    el.innerHTML = "<h2>Fixture Ticker</h2>" + fixtures.slice(0, 10).map(f => `
        <div class="card flex-between">
            <span><strong>${teams[f.team_h]}</strong> v ${teams[f.team_a]}</span>
            <span class="diff-chip" style="background:${f.team_h_difficulty <= 2 ? 'var(--fpl-green)' : (f.team_h_difficulty >= 4 ? 'var(--fpl-pink)' : '#cbd5e0')}">GW${f.event}</span>
        </div>`).join("");
}

// 4. Scout Planner & Comparison Tool
function renderPlanner(bootstrap) {
    const el = document.getElementById("transfers");
    el.innerHTML = `
        <h2>Scout Comparison Tool</h2>
        <div class="card">
            <input type="text" id="playerSearch" class="fpl-input" placeholder="${lockedPlayer ? 'Search Player B to compare...' : 'Search Player A...'}">
            <div id="plannerOutput"></div>
        </div>`;

    document.getElementById("playerSearch").oninput = (e) => {
        const query = e.target.value.toLowerCase();
        if (query.length < 3) return;
        const player = bootstrap.elements.find(p => p.web_name.toLowerCase().includes(query));
        if (player) {
            const team = bootstrap.teams.find(t => t.id === player.team).name;
            document.getElementById("plannerOutput").innerHTML = `
                <div class="scout-result-animated" style="margin-top:15px; border-top:1px solid #edf2f7; padding-top:20px;">
                    <div class="flex-between">
                        <div><h3>${player.web_name}</h3><small>${team} • £${(player.now_cost/10).toFixed(1)}m</small></div>
                        <button class="secondary-btn" onclick="lockPlayer(${player.id})">${lockedPlayer ? 'Compare with A' : 'Set as A'}</button>
                    </div>
                    <div class="stat-row-mini">
                        <span><strong>xG:</strong> ${player.expected_goals}</span>
                        <span><strong>xA:</strong> ${player.expected_assists}</span>
                        <span><strong>Form:</strong> ${player.form}</span>
                    </div>
                </div>`;
        }
    };
}

window.lockPlayer = function(id) {
    const bootstrap = JSON.parse(localStorage.getItem("fpl_bootstrap")).data;
    const player = bootstrap.elements.find(p => p.id === id);
    if (!lockedPlayer) {
        lockedPlayer = player;
        renderPlanner(bootstrap);
    } else {
        showComparisonModal(lockedPlayer, player, bootstrap);
        lockedPlayer = null;
        renderPlanner(bootstrap);
    }
};

function showComparisonModal(pA, pB, bootstrap) {
    const teamA = bootstrap.teams.find(t => t.id === pA.team).short_name;
    const teamB = bootstrap.teams.find(t => t.id === pB.team).short_name;

    const modalHtml = `
        <div class="comparison-overlay">
            <div class="comparison-modal">
                <div class="flex-between" style="margin-bottom:20px;">
                    <h2 style="border:none; margin:0;">Head-to-Head</h2>
                    <span style="font-size:2rem; cursor:pointer;" onclick="this.parentElement.parentElement.parentElement.remove()">&times;</span>
                </div>
                <table class="comparison-table">
                    <thead><tr><th>Metric</th><th>${pA.web_name}</th><th>${pB.web_name}</th></tr></thead>
                    <tbody>
                        <tr><td>Team</td><td>${teamA}</td><td>${teamB}</td></tr>
                        <tr><td>Price</td><td>£${(pA.now_cost/10).toFixed(1)}m</td><td>£${(pB.now_cost/10).toFixed(1)}m</td></tr>
                        <tr><td>xG</td><td class="${pA.expected_goals > pB.expected_goals ? 'winner':''}">${pA.expected_goals}</td><td class="${pB.expected_goals > pA.expected_goals ? 'winner':''}">${pB.expected_goals}</td></tr>
                        <tr><td>xA</td><td class="${pA.expected_assists > pB.expected_assists ? 'winner':''}">${pA.expected_assists}</td><td class="${pB.expected_assists > pA.expected_assists ? 'winner':''}">${pB.expected_assists}</td></tr>
                        <tr><td>Points</td><td class="${pA.total_points > pB.total_points ? 'winner':''}">${pA.total_points}</td><td class="${pB.total_points > pA.total_points ? 'winner':''}">${pB.total_points}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
