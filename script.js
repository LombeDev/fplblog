/* ================= CONFIGURATION ================= */
const LEAGUE_ID = 101712;
const PROXY_BASE = "https://api.allorigins.win/get?url=";
const FPL_BASE = "https://fantasy.premierleague.com/api/";

/* ================= CACHE ENGINE ================= */
async function fetchFPL(key, path, ttl = 1800000) {
    // 1. Check Local Cache
    const cached = localStorage.getItem(key);
    if (cached) {
        const { data, expiry } = JSON.parse(cached);
        if (Date.now() < expiry && data !== null) return data;
    }

    try {
        // 2. Fetch via AllOrigins Proxy
        const targetUrl = encodeURIComponent(`${FPL_BASE}${path}/`);
        const res = await fetch(`${PROXY_BASE}${targetUrl}`);
        
        if (!res.ok) throw new Error("Proxy connection failed");
        
        const wrapper = await res.json();
        // The actual FPL data is stringified inside wrapper.contents
        const data = JSON.parse(wrapper.contents); 

        // 3. Save to Cache
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

/* ================= AUTHENTICATION (Netlify Identity) ================= */
if (window.netlifyIdentity) {
    netlifyIdentity.on("init", user => {
        if (user) showDashboard();
    });
    netlifyIdentity.on("login", user => {
        showDashboard();
        netlifyIdentity.close();
    });
    netlifyIdentity.on("logout", () => {
        localStorage.clear();
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
        document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active-tab"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active-tab");
    };
});

/* ================= DATA LOADING ================= */
async function loadAllSections() {
    // Show loading state
    document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "Fetching live FPL data...");

    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000); // 24h cache
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`);

    if (league && bootstrap) {
        renderMembers(league);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPredictions();
        renderPlanner();
    } else {
        document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "Error loading data. FPL API may be down.");
    }
}

function renderMembers(league) {
    const el = document.getElementById("members");
    el.innerHTML = `<h2>${league.league.name} Standings</h2>`;
    league.standings.results.forEach(m => {
        el.innerHTML += `
            <div class="card">
                <span><strong>${m.rank}.</strong> ${m.player_name} (${m.entry_name})</span>
                <span style="color: #00ff87; font-weight:bold;">${m.total} pts</span>
            </div>`;
    });
}

async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    const gw = bootstrap.events.find(e => e.is_current).id;
    const playerNames = {};
    bootstrap.elements.forEach(p => playerNames[p.id] = p.web_name);

    const counts = {};
    const topManagers = league.standings.results.slice(0, 5);

    for (const m of topManagers) {
        const picks = await fetchFPL(`picks_${m.entry}_${gw}`, `entry/${m.entry}/event/${gw}/picks`);
        if (picks && picks.picks) {
            picks.picks.forEach(p => {
                counts[p.element] = (counts[p.element] || 0) + 1;
            });
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 11);
    el.innerHTML = `<h2>Community XI</h2><p style="color:#888; font-size:0.8rem;">Most owned by top 5 rivals</p>`;
    sorted.forEach(([id, count]) => {
        const pct = (count / topManagers.length) * 100;
        el.innerHTML += `
            <div class="card">
                <span>${playerNames[id]}</span>
                <span style="color: #00ff87">${pct}%</span>
            </div>`;
    });
}

async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teamMap = {};
    bootstrap.teams.forEach(t => teamMap[t.id] = t.name);

    el.innerHTML = "<h2>Fixture Ticker</h2>";
    if (fixtures) {
        fixtures.slice(0, 10).forEach(f => {
            el.innerHTML += `
                <div class="card">
                    <span>${teamMap[f.team_h]} vs ${teamMap[f.team_a]}</span>
                    <span style="background:${f.team_h_difficulty <= 2 ? '#00ff87' : '#ff005a'}; color:#000; padding:2px 6px; border-radius:4px; font-weight:bold;">GW${f.event}</span>
                </div>`;
        });
    }
}

function renderPredictions() {
    document.getElementById("predictions").innerHTML = `
        <h2>Predictions</h2>
        <div class="card" style="display:block">
            <p><strong>Predicted GW Average:</strong> 54 pts</p>
            <p>🎯 <strong>Top Captain:</strong> M. Salah</p>
        </div>`;
}

function renderPlanner() {
    document.getElementById("transfers").innerHTML = `
        <h2>Planner</h2>
        <div class="card" style="display:block">
            <input type="text" placeholder="OUT" style="width:100%; margin-bottom:10px; padding:8px;">
            <input type="text" placeholder="IN" style="width:100%; margin-bottom:10px; padding:8px;">
            <button style="width:100%; background:#00ff87; border:none; padding:10px; font-weight:bold; cursor:pointer;">Analyze</button>
        </div>`;
}
