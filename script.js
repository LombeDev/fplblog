/* ================= CONFIGURATION ================= */
const LEAGUE_ID = 101712;
const PROXY_URL = "/.netlify/functions/fpl-proxy"; 

/* ================= CACHE ENGINE ================= */
async function fetchFPL(key, path, ttl = 1800000) {
    const cached = localStorage.getItem(key);
    if (cached) {
        const { data, expiry } = JSON.parse(cached);
        if (Date.now() < expiry && data !== null) return data;
    }

    try {
        const res = await fetch(`${PROXY_URL}?path=${encodeURIComponent(path)}`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        
        if (data && !data.error) {
            localStorage.setItem(key, JSON.stringify({
                data,
                expiry: Date.now() + ttl
            }));
        }
        return data;
    } catch (err) {
        console.error(`Fetch Error [${path}]:`, err);
        return null;
    }
}

/* ================= AUTHENTICATION (Netlify Identity) ================= */
if (window.netlifyIdentity) {
    netlifyIdentity.on("init", user => { if (user) showDashboard(); });
    netlifyIdentity.on("login", user => { showDashboard(); netlifyIdentity.close(); });
    netlifyIdentity.on("logout", () => { localStorage.clear(); location.reload(); });
}

function showDashboard() {
    document.getElementById("auth-overlay").style.display = "none";
    document.getElementById("app").style.display = "block";
    loadAllSections();
}

document.getElementById("logoutBtn").onclick = () => netlifyIdentity.logout();

/* ================= NAVIGATION & HAMBURGER LOGIC ================= */
const menuToggle = document.getElementById('menuToggle');
const sideNav = document.getElementById('sideNav');
const navOverlay = document.getElementById('navOverlay');
const closeNav = document.getElementById('closeNav');

function toggleMenu() {
    sideNav.classList.toggle('open');
    navOverlay.classList.toggle('show');
}

if(menuToggle) menuToggle.onclick = toggleMenu;
if(closeNav) closeNav.onclick = toggleMenu;
if(navOverlay) navOverlay.onclick = toggleMenu;

document.querySelectorAll(".nav-link").forEach(btn => {
    btn.onclick = () => {
        // Handle Tab Switching
        document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active-tab"));
        
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active-tab");

        // Close Sidebar on Mobile
        sideNav.classList.remove('open');
        navOverlay.classList.remove('show');
    };
});

/* ================= DATA LOADING ================= */
async function loadAllSections() {
    document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "<div class='loader'>Syncing Scout Data...</div>");

    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000);
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`);

    if (league && bootstrap) {
        renderMembers(league);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPredictions(bootstrap);
        renderPlanner(bootstrap);
    } else {
        document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "Error loading FPL data. Check Proxy.");
    }
}

/* 1. MEMBERS LIST */
function renderMembers(league) {
    const el = document.getElementById("members");
    let html = `<h2>League Standings <span class="badge">Live</span></h2><div class="card" style="padding:0;">`;
    html += `<table class="fpl-table">
        <thead><tr><th>Rank</th><th>Manager</th><th style="text-align:right">Points</th></tr></thead>
        <tbody>`;
    league.standings.results.forEach(m => {
        html += `
            <tr>
                <td style="font-weight:bold; color:var(--fpl-text-muted); padding-left:15px;">${m.rank}</td>
                <td><span style="font-weight:700; color:var(--fpl-navy)">${m.player_name}</span><br><small style="color:var(--fpl-text-muted)">${m.entry_name}</small></td>
                <td style="text-align:right; padding-right:15px;" class="txt-green">${m.total}</td>
            </tr>`;
    });
    html += `</tbody></table></div>`;
    el.innerHTML = html;
}

/* 2. CONSENSUS XI (COMMUNITY) */
async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {};
    bootstrap.elements.forEach(p => playerMap[p.id] = { name: p.web_name, status: p.status });

    const counts = {};
    const top5 = league.standings.results.slice(0, 5);

    for (const m of top5) {
        const picksData = await fetchFPL(`picks_${m.entry}_${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (picksData?.picks) {
            picksData.picks.forEach(p => counts[p.element] = (counts[p.element] || 0) + 1);
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 11);
    el.innerHTML = `<h2>Consensus XI <small style="font-weight:normal; color:var(--fpl-text-muted)">Top 5 Managers Choice</small></h2>`;
    sorted.forEach(([id, count]) => {
        const p = playerMap[id];
        const pct = (count / 5) * 100;
        el.innerHTML += `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; padding:12px 20px;">
                <span style="font-weight:600;">${p.status !== 'a' ? '⚠️' : '✅'} ${p.name}</span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:100px; height:8px; background:#edf2f7; border-radius:4px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:var(--fpl-green);"></div>
                    </div>
                    <span style="font-size:0.8rem; font-weight:bold; width:35px;">${pct}%</span>
                </div>
            </div>`;
    });
}

/* 3. FIXTURE TICKER */
async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teams = {};
    bootstrap.teams.forEach(t => teams[t.id] = { name: t.short_name });

    el.innerHTML = "<h2>Scout Fixture Ticker</h2>";
    if (fixtures) {
        fixtures.slice(0, 15).forEach(f => {
            const diffColor = f.team_h_difficulty <= 2 ? '#00ff87' : (f.team_h_difficulty >= 4 ? '#ff005a' : '#718096');
            el.innerHTML += `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px;">
                    <span style="font-weight:bold;">${teams[f.team_h].name} <span style="color:#cbd5e0; font-weight:normal;">v</span> ${teams[f.team_a].name}</span>
                    <span class="diff-chip" style="background:${diffColor}">GW${f.event}</span>
                </div>`;
        });
    }
}

/* 4. CAPTAINCY POLL */
function renderPredictions(bootstrap) {
    const el = document.getElementById("predictions");
    const userVote = localStorage.getItem("fpl_user_vote");
    const candidates = [...bootstrap.elements].sort((a, b) => b.form - a.form).slice(0, 3);

    let html = `<h2>Captaincy Poll</h2><div class="card"><p style="margin-bottom:1.5rem; color:var(--fpl-text-muted);">Who gets the armband?</p>`;
    candidates.forEach(p => {
        const isSelected = userVote === p.web_name;
        html += `
            <div class="poll-option ${isSelected ? 'selected' : ''}" onclick="handleVote('${p.web_name}')">
                <span>${p.web_name} <small>(${p.form} form)</small></span>
                <span>${isSelected ? '⭐' : ''}</span>
            </div>`;
    });
    html += `</div>`;
    el.innerHTML = html;
}

window.handleVote = function(playerName) {
    localStorage.setItem("fpl_user_vote", playerName);
    const bootstrap = JSON.parse(localStorage.getItem("fpl_bootstrap")).data;
    renderPredictions(bootstrap);
};

/* 5. SCOUT PLANNER (SEARCH) */
function renderPlanner(bootstrap) {
    const el = document.getElementById("transfers");
    el.innerHTML = `<h2>Scouting Tool</h2><div class="card">
        <input type="text" id="playerSearch" class="fpl-input" placeholder="Search for a player...">
        <div id="plannerOutput"></div></div>`;

    document.getElementById("playerSearch").oninput = (e) => {
        const query = e.target.value.toLowerCase();
        if (query.length < 3) return;
        
        const player = bootstrap.elements.find(p => p.web_name.toLowerCase().includes(query));
        if (player) {
            const team = bootstrap.teams.find(t => t.id === player.team).name;
            document.getElementById("plannerOutput").innerHTML = `
                <div style="margin-top:15px; border-top:1px solid #edf2f7; padding-top:15px;">
                    <h3 style="color:var(--fpl-navy)">${player.first_name} ${player.second_name}</h3>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:10px;">
                        <div><small>Team</small><br><strong>${team}</strong></div>
                        <div><small>Price</small><br><strong>£${(player.now_cost / 10).toFixed(1)}m</strong></div>
                        <div><small>Form</small><br><strong>${player.form}</strong></div>
                        <div><small>Total Pts</small><br><strong>${player.total_points}</strong></div>
                    </div>
                </div>`;
        }
    };
}
