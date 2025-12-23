/* ================= CONFIGURATION ================= */
const LEAGUE_ID = 101712;
// Points to your Netlify serverless function
const PROXY_URL = "/.netlify/functions/fpl-proxy"; 

/* ================= CACHE ENGINE ================= */
/**
 * Fetches data with localStorage caching to avoid FPL rate limits
 */
async function fetchFPL(key, path, ttl = 1800000) { // 30 min default cache
    const cached = localStorage.getItem(key);
    if (cached) {
        const { data, expiry } = JSON.parse(cached);
        if (Date.now() < expiry && data !== null) return data;
    }

    try {
        const res = await fetch(`${PROXY_URL}?path=${encodeURIComponent(path)}`);
        
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        
        const data = await res.json();
        
        // Only cache if the data is valid
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
    netlifyIdentity.on("init", user => {
        if (user) showDashboard();
    });
    netlifyIdentity.on("login", user => {
        showDashboard();
        netlifyIdentity.close();
    });
    netlifyIdentity.on("logout", () => {
        localStorage.clear(); // Clear cache on logout
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

/* ================= DATA LOADING & RENDERING ================= */
async function loadAllSections() {
    // Show temporary loading indicators
    document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "<p>Updating live data...</p>");

    const bootstrap = await fetchFPL("fpl_bootstrap", "bootstrap-static", 86400000); // 24h
    const league = await fetchFPL("fpl_league", `leagues-classic/${LEAGUE_ID}/standings`);

    if (league && bootstrap) {
        renderMembers(league);
        renderCommunityXI(league, bootstrap);
        renderFixtures(bootstrap);
        renderPredictions();
        renderPlanner();
    } else {
        document.querySelectorAll(".tab-content").forEach(el => el.innerHTML = "Error: Could not connect to FPL API.");
    }
}

/* 1. Members Area */
function renderMembers(league) {
    const el = document.getElementById("members");
    let html = `<h2>${league.league.name}</h2>`;
    league.standings.results.forEach(m => {
        html += `
            <div class="card">
                <span><strong>${m.rank}.</strong> ${m.player_name}</span>
                <span style="color: #00ff87; font-weight:bold;">${m.total} pts</span>
            </div>`;
    });
    el.innerHTML = html;
}

/* 2. Community XI (Consensus Logic) */
async function renderCommunityXI(league, bootstrap) {
    const el = document.getElementById("popular");
    const currentGW = bootstrap.events.find(e => e.is_current)?.id || 1;
    const playerMap = {};
    bootstrap.elements.forEach(p => playerMap[p.id] = p.web_name);

    const counts = {};
    const topManagers = league.standings.results.slice(0, 5); // Take top 5 rivals

    // Gather picks from top rivals
    for (const m of topManagers) {
        const picksData = await fetchFPL(`picks_${m.entry}_${currentGW}`, `entry/${m.entry}/event/${currentGW}/picks`);
        if (picksData && picksData.picks) {
            picksData.picks.forEach(p => {
                counts[p.element] = (counts[p.element] || 0) + 1;
            });
        }
    }

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 11);
    
    let html = `<h2>Community XI</h2><p style="font-size:0.8rem; color:#888;">Most selected players in the top 5 of your league</p>`;
    sorted.forEach(([id, count]) => {
        const pct = (count / topManagers.length) * 100;
        html += `
            <div class="card">
                <span>${playerMap[id]}</span>
                <span style="color: #00ff87">${pct}%</span>
            </div>`;
    });
    el.innerHTML = html;
}

/* 3. Fixture Ticker */
async function renderFixtures(bootstrap) {
    const el = document.getElementById("fixtures");
    const fixtures = await fetchFPL("fpl_fixtures", "fixtures?future=1", 3600000);
    const teams = {};
    bootstrap.teams.forEach(t => teams[t.id] = t.name);

    let html = "<h2>Fixture Ticker</h2>";
    if (fixtures) {
        fixtures.slice(0, 10).forEach(f => {
            const diffColor = f.team_h_difficulty <= 2 ? '#00ff87' : (f.team_h_difficulty >= 4 ? '#ff005a' : '#e1e1e1');
            html += `
                <div class="card">
                    <span>${teams[f.team_h]} vs ${teams[f.team_a]}</span>
                    <span style="background:${diffColor}; color:#000; padding:2px 6px; border-radius:4px; font-weight:bold;">GW${f.event}</span>
                </div>`;
        });
    }
    el.innerHTML = html;
}

/* 4. Predictions & 5. Planner (UI placeholders) */
function renderPredictions() {
    document.getElementById("predictions").innerHTML = `
        <h2>Points Predictions</h2>
        <div class="card" style="display:block">
            <p><strong>Predicted Top Scorer:</strong> M. Salah (7.8 pts)</p>
            <p><strong>Clean Sheet Probability:</strong> Arsenal (52%)</p>
        </div>`;
}

function renderPlanner() {
    document.getElementById("transfers").innerHTML = `
        <h2>Transfer Planner</h2>
        <div class="card" style="display:block; text-align:center;">
            <p>Analyze upcoming schedule difficulty</p>
            <button class="secondary-btn" style="background:#00ff87; color:#000; border:none; padding:10px 20px; border-radius:4px; font-weight:bold; cursor:pointer;">Launch Planner</button>
        </div>`;
}
