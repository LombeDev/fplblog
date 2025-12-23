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
            localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + ttl }));
        }
        return data;
    } catch (err) {
        console.error(`Fetch Error [${path}]:`, err);
        return null;
    }
}

/* ================= AUTHENTICATION ================= */
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

/* ================= NAVIGATION ================= */
document.querySelectorAll(".nav-link").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active-tab"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active-tab");
    };
});

/* ================= DATA LOADING ================= */
async function loadAllSections() {
    document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "<p>Loading live FPL data...</p>");

    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000);
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`);

    if (league && bootstrap) {
        renderMembers(league);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPredictions(bootstrap);
        renderPlanner(bootstrap);
    } else {
        document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "Error: FPL connection failed.");
    }
}

/* 1. MEMBERS SECTION */
function renderMembers(league) {
    const el = document.getElementById("members");
    el.innerHTML = `<h2>${league.league.name}</h2>` + league.standings.results.map(m => `
        <div class="card">
            <span><strong>${m.rank}.</strong> ${m.player_name} (${m.entry_name})</span>
            <span style="color: #00ff87; font-weight:bold;">${m.total} pts</span>
        </div>`).join("");
}

/* 2. COMMUNITY XI */
async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {};
    bootstrap.elements.forEach(p => playerMap[p.id] = p.web_name);

    const counts = {};
    const topManagers = league.standings.results.slice(0, 5);

    for (const m of topManagers) {
        const picksData = await fetchFPL(`picks_${m.entry}_${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (picksData?.picks) {
            picksData.picks.forEach(p => counts[p.element] = (counts[p.element] || 0) + 1);
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 11);
    el.innerHTML = `<h2>Community XI</h2><p style="font-size:0.8rem; color:#888;">Consensus picks from your top 5 rivals</p>` + 
        sorted.map(([id, count]) => `
        <div class="card"><span>${playerMap[id]}</span><span style="color: #00ff87">${(count/5)*100}%</span></div>`).join("");
}

/* 3. FIXTURE TICKER */
async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teams = {};
    bootstrap.teams.forEach(t => teams[t.id] = { name: t.short_name });

    if (!fixtures) return;

    el.innerHTML = "<h2>Fixture Ticker</h2>" + fixtures.slice(0, 12).map(f => {
        const diffColor = f.team_h_difficulty <= 2 ? '#00ff87' : (f.team_h_difficulty >= 4 ? '#ff005a' : '#e1e1e1');
        return `
            <div class="card" style="display:flex; justify-content:space-between; align-items:center;">
                <span><strong>${teams[f.team_h].name}</strong> vs <strong>${teams[f.team_a].name}</strong></span>
                <span style="background:${diffColor}; color:#000; padding:2px 8px; border-radius:4px; font-weight:bold; font-size:0.8rem;">GW${f.event}</span>
            </div>`;
    }).join("");
}

/* 4. PREDICTIONS */
function renderPredictions(bootstrap) {
    const topForm = [...bootstrap.elements].sort((a, b) => b.form - a.form)[0];
    document.getElementById("predictions").innerHTML = `
        <h2>Points Predictions</h2>
        <div class="card" style="display:block">
            <p>🔥 <strong>Form Player:</strong> ${topForm.web_name} (Form: ${topForm.form})</p>
            <p>🎯 <strong>Recommended Captain:</strong> M. Salah</p>
            <p>🛡️ <strong>Clean Sheet Tip:</strong> Arsenal (45% probability)</p>
        </div>`;
}

/* 5. INTERACTIVE PLANNER */
function renderPlanner(bootstrap) {
    const el = document.getElementById("transfers");
    el.innerHTML = `
        <h2>Transfer Planner</h2>
        <div class="card" style="display:block">
            <input type="text" id="playerSearch" placeholder="Search player (e.g. Palmer)" style="width:100%; padding:10px; background:#2a2a2a; border:1px solid #444; color:white; border-radius:4px;">
            <div id="plannerOutput" style="margin-top:15px;"></div>
        </div>`;

    document.getElementById("playerSearch").oninput = (e) => {
        const query = e.target.value.toLowerCase();
        if (query.length < 3) return;
        
        const player = bootstrap.elements.find(p => p.web_name.toLowerCase().includes(query));
        const output = document.getElementById("plannerOutput");
        
        if (player) {
            const team = bootstrap.teams.find(t => t.id === player.team);
            output.innerHTML = `
                <div style="padding:10px; background:#1a1a1a; border-radius:4px;">
                    <p><strong>${player.web_name}</strong> (${team.name})</p>
                    <p>Price: £${(player.now_cost / 10).toFixed(1)}m | Form: ${player.form}</p>
                </div>`;
        } else {
            output.innerHTML = "<p>Player not found.</p>";
        }
    };
}
