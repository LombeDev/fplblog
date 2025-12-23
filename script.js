/* ================= CONFIGURATION ================= */
const LEAGUE_ID = 101712;
const PROXY_URL = "fpl-proxy";

/* ================= CACHE ENGINE ================= */
/**
 * Generic fetcher with localStorage caching
 * @param {string} key - Unique key for localStorage
 * @param {string} path - FPL API endpoint path
 * @param {number} ttl - Time to live in milliseconds
 */
async function fetchFPL(key, path, ttl = 1800000) { // 30 min default cache
    const cached = localStorage.getItem(key);
    if (cached) {
        const { data, expiry } = JSON.parse(cached);
        if (Date.now() < expiry) return data;
    }

    try {
        const res = await fetch(`${PROXY_URL}?path=${path}`);
        if (!res.ok) throw new Error("Network response was not ok");
        const data = await res.json();
        
        localStorage.setItem(key, JSON.stringify({
            data,
            expiry: Date.now() + ttl
        }));
        return data;
    } catch (err) {
        console.error(`Error fetching ${path}:`, err);
        return null;
    }
}

/* ================= AUTHENTICATION ================= */
if (window.netlifyIdentity) {
    netlifyIdentity.on("init", user => {
        if (user) showDashboard();
    });
    netlifyIdentity.on("login", user => {
        showDashboard();
        netlifyIdentity.close();
    });
    netlifyIdentity.on("logout", () => {
        location.reload();
    });
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
        // UI Toggle
        document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active-tab"));
        
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active-tab");
    };
});

/* ================= DATA LOADING ================= */
async function loadAllSections() {
    // Load Bootstrap and League data first as they are dependencies
    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000); // 24h cache
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`);

    if (league && bootstrap) {
        renderMembers(league);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPredictions();
        renderPlanner();
    }
}

/* 1. MEMBERS SECTION */
function renderMembers(league) {
    const el = document.getElementById("members");
    el.innerHTML = `<h2>${league.league.name} Standings</h2>`;
    league.standings.results.forEach(m => {
        el.innerHTML += `
            <div class="card">
                <span><strong>${m.rank}.</strong> ${m.player_name} (${m.entry_name})</span>
                <span style="color: var(--fpl-green)">${m.total} pts</span>
            </div>`;
    });
}

/* 2. COMMUNITY XI (CONSENSUS) */
async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    el.innerHTML = "<h2>Community XI</h2><p>Analyzing top 5 managers...</p>";

    const gw = bootstrap.events.find(e => e.is_current).id;
    const playerNames = {};
    bootstrap.elements.forEach(p => playerNames[p.id] = p.web_name);

    const counts = {};
    const topManagers = league.standings.results.slice(0, 5);

    for (const m of topManagers) {
        const picks = await fetchFPL(`picks_${m.entry}_${gw}`, `entry/${m.entry}/event/${gw}/picks`);
        if (picks) {
            picks.picks.forEach(p => {
                counts[p.element] = (counts[p.element] || 0) + 1;
            });
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 11);
    
    el.innerHTML = `<h2>Community XI</h2><p class="subtitle">Most owned by top rivals</p>`;
    sorted.forEach(([id, count]) => {
        const pct = (count / topManagers.length) * 100;
        el.innerHTML += `
            <div class="card">
                <span>${playerNames[id]}</span>
                <span class="percentage-label">${pct}% owned</span>
            </div>`;
    });
}

/* 3. FIXTURE TICKER */
async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teamMap = {};
    bootstrap.teams.forEach(t => teamMap[t.id] = t.name);

    el.innerHTML = "<h2>Fixture Ticker</h2>";
    fixtures.slice(0, 12).forEach(f => {
        el.innerHTML += `
            <div class="card">
                <span>${teamMap[f.team_h]} vs ${teamMap[f.team_a]}</span>
                <span class="difficulty-pill ${f.team_h_difficulty <= 2 ? 'easy' : 'hard'}">
                    GW${f.event}
                </span>
            </div>`;
    });
}

/* 4. PREDICTIONS */
function renderPredictions() {
    document.getElementById("predictions").innerHTML = `
        <h2>Points Predictions</h2>
        <div class="card" style="display:block">
            <p><strong>Predicted Average:</strong> 54 pts</p>
            <hr>
            <p>🎯 <strong>Top Captain:</strong> M. Salah</p>
            <p>🛡️ <strong>Clean Sheet Odds:</strong> Arsenal (54%)</p>
        </div>`;
}

/* 5. TRANSFER PLANNER */
function renderPlanner() {
    document.getElementById("transfers").innerHTML = `
        <h2>Transfer Planner</h2>
        <div class="card" style="display:block">
            <input type="text" placeholder="Player OUT" style="width:100%; padding:10px; margin-bottom:10px;">
            <input type="text" placeholder="Player IN" style="width:100%; padding:10px; margin-bottom:10px;">
            <button class="secondary-btn" style="width:100%">Compare Fixtures</button>
        </div>`;
}
