/**
 * FFH Re-Engineering: Full UI Logic
 * Handles the visual representation of the pitch, bench, and player cards.
 */

const UI = {
    // Configuration for the standard FPL squad layout
    formationSchema: { 'GKP': 1, 'DEF': 5, 'MID': 5, 'FWD': 3 },
    
    // Difficulty color mapping (FDR)
    fdrColors: { 1: '#00ff87', 2: '#01fc7a', 3: '#ebebeb', 4: '#ff005a', 5: '#80002d' },

    /**
     * Main render function - call this whenever gameState.squad changes
     */
    init: function() {
        this.renderPitch();
        this.renderBench();
        this.updateHeaderStats();
    },

    renderPitch: function() {
        const starterIds = gameState.squad.slice(0, 11).map(p => p.id);
        const starters = gameState.squad.filter(p => starterIds.includes(p.id));

        // Clear existing rows
        ['GKP', 'DEF', 'MID', 'FWD'].forEach(pos => {
            document.getElementById(`${pos}-row`).innerHTML = '';
        });

        // Place players in their respective rows
        starters.forEach(player => {
            const rowId = `${POS_MAP[player.pos]}-row`;
            const container = document.getElementById(rowId);
            container.innerHTML += this.createPlayerHTML(player, false);
        });

        this.fillEmptySlots(starters);
    },

    renderBench: function() {
        const benchContainer = document.getElementById('bench-row');
        benchContainer.innerHTML = '';
        const benchPlayers = gameState.squad.slice(11, 15);

        benchPlayers.forEach(player => {
            benchContainer.innerHTML += this.createPlayerHTML(player, true);
        });
    },

    /**
     * Creates the Hub-style player card
     */
    createPlayerHTML: function(p, isBench) {
        const statusBadge = getStatusBadge(p.status, p.news);
        const fixtures = this.getFixtureStrip(p.teamId);
        
        return `
            <div class="player-card ${isBench ? 'on-bench' : ''}" id="p-${p.id}">
                ${statusBadge}
                <div class="shirt-wrapper">
                    ${this.getShirtSVG(p.teamId)}
                </div>
                <div class="card-label">
                    <div class="name">${p.name}</div>
                    <div class="price">£${p.price.toFixed(1)}</div>
                </div>
                <div class="fixture-ticker">
                    ${fixtures}
                </div>
                <button class="remove-btn" onclick="removePlayerFromDraft(${p.id})">×</button>
            </div>
        `;
    },

    /**
     * Generates the 3-GW fixture difficulty boxes
     */
    getFixtureStrip: function(teamId) {
        // Assume globalFixtures is populated from api.js
        const nextThree = globalFixtures[teamId] ? globalFixtures[teamId].slice(0, 3) : [];
        
        return nextThree.map(fix => `
            <div class="f-box" style="background:${this.fdrColors[fix.difficulty]}">
                ${fix.opponentShort}
            </div>
        `).join('');
    },

    /**
     * Draws the team-specific SVG jersey
     */
    getShirtSVG: function(teamId) {
        const colors = teamColors[teamId] || { primary: "#ccc", secondary: "#999" };
        return `
            <svg viewBox="0 0 100 100" width="40" height="40">
                <path d="M20,30 L80,30 L85,90 L15,90 Z" fill="${colors.primary}" />
                <path d="M20,30 L10,50 L20,60 L30,40 Z" fill="${colors.secondary}" />
                <path d="M80,30 L90,50 L80,60 L70,40 Z" fill="${colors.secondary}" />
                <circle cx="50" cy="30" r="10" fill="#222" />
            </svg>
        `;
    },

    /**
     * Adds the gray "+" boxes for missing players
     */
    fillEmptySlots: function(starters) {
        const counts = starters.reduce((acc, p) => {
            const pos = POS_MAP[p.pos];
            acc[pos] = (acc[pos] || 0) + 1;
            return acc;
        }, {});

        ['GKP', 'DEF', 'MID', 'FWD'].forEach(pos => {
            const current = counts[pos] || 0;
            const max = this.formationSchema[pos];
            const container = document.getElementById(`${pos}-row`);

            for (let i = current; i < max; i++) {
                container.innerHTML += `
                    <div class="empty-slot" onclick="UI.openSearch('${pos}')">
                        <span>+</span>
                    </div>
                `;
            }
        });
    },

    updateHeaderStats: function() {
        document.getElementById('bank-val').innerText = `£${gameState.bank.toFixed(1)}m`;
        document.getElementById('value-val').innerText = `£${gameState.totalValue.toFixed(1)}m`;
    },

    openSearch: function(pos) {
        // Trigger sidebar and set position filter
        console.log(`Opening search for: ${pos}`);
        setSidebarPosition(pos);
    }
};