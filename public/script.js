document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // --- DOM Elements ---
    const authStatus = document.getElementById('auth-status');
    const authButton = document.getElementById('auth-button');
    const logoutButton = document.getElementById('logout-button');
    const userBalanceDisplay = document.createElement('span');
    userBalanceDisplay.className = 'user-balance';
    userBalanceDisplay.style.marginLeft = '10px';

    const navLinks = document.querySelectorAll('.main-nav a');
    const sections = document.querySelectorAll('.content-section');

    // Home Section (removed from HTML, but keeping references for consistency if needed elsewhere)
    // const overviewUpcomingMatches = document.getElementById('overview-upcoming-matches');
    // const overviewTotalUsers = document.getElementById('overview-total-users');
    // const overviewTotalBets = document.getElementById('overview-total-bets');
    // const overviewTotalVolume = document.getElementById('overview-total-volume');

    // Profile Section
    const profileUserAvatar = document.getElementById('profile-user-avatar');
    const profileUsername = document.getElementById('profile-username');
    const profileBalance = document.getElementById('profile-balance');
    const profileTotalBets = document.getElementById('profile-total-bets');
    const profileWonBets = document.getElementById('profile-won-bets');
    const profileLostBets = document.getElementById('profile-lost-bets');
    const profileNetWinnings = document.getElementById('profile-net-winnings');
    const profileWinRate = document.getElementById('profile-win-rate');
    const myBetsList = document.getElementById('my-bets-list'); // Moved to profile section

    // Matches Section
    const upcomingMatchesList = document.getElementById('upcoming-matches-list');

    // Betting Section
    const betMatchSelect = document.getElementById('bet-match-select');
    const selectedMatchDetails = document.getElementById('selected-match-details');
    const betMatchId = document.getElementById('bet-match-id');
    const betMatchTeams = document.getElementById('bet-match-teams');
    const betMatchTime = document.getElementById('bet-match-time');

    // Moved up in HTML
    const betTypeSelect = document.getElementById('bet-type-select');

    // These containers will be dynamically shown/hidden
    const basicOddsContainer = document.getElementById('basic-odds-container');
    const specialOddsContainer = document.getElementById('special-odds-container');
    const specialCombinedCheckboxes = document.getElementById('special-combined-checkboxes'); // New combined checkboxes container

    const simpleBetOptions = document.getElementById('simple-bet-options');
    const specialBetOptions = document.getElementById('special-bet-options');
    const specialCombinedBetOptions = document.getElementById('special-combined-bet-options'); // New combined bet section

    const simplePredictionSelect = document.getElementById('simple-prediction');
    const simpleSelectedOdds = document.getElementById('simple-selected-odds');
    const specialTypeSelect = document.getElementById('special-type-select');
    const specialSelectedOdds = document.getElementById('special-selected-odds');

    const combinedSelectedOdds = document.getElementById('combined-selected-odds'); // New combined odds display
    const betAmountInput = document.getElementById('bet-amount');
    const potentialWinningsDisplay = document.getElementById('potential-winnings'); // New calculator display
    const placeBetButton = document.getElementById('place-bet-button');
    const betMessage = document.getElementById('bet-message');

    // Finished Matches Section (formerly Stats)
    const finishedMatchesList = document.getElementById('finished-matches-list');

    // Leaderboard Section
    const leaderboardTableBody = document.querySelector('#leaderboard-table tbody');
    
    // Admin Section Elements
    const adminNavItem = document.getElementById('admin-nav-item');
    const adminMatchSelect = document.getElementById('admin-match-select');
    const adminMatchDetails = document.getElementById('admin-match-details');
    const adminMatchId = document.getElementById('admin-match-id');
    const adminMatchTeams = document.getElementById('admin-match-teams');
    const adminMatchTime = document.getElementById('admin-match-time');
    const adminMatchBetsCount = document.getElementById('admin-match-bets-count');
    const adminTeam1Label = document.getElementById('admin-team1-label');
    const adminTeam2Label = document.getElementById('admin-team2-label');
    const adminScore1 = document.getElementById('admin-score1');
    const adminScore2 = document.getElementById('admin-score2');
    const adminCorners = document.getElementById('admin-corners');
    const adminYellowCards = document.getElementById('admin-yellow-cards');
    const adminRedCards = document.getElementById('admin-red-cards');
    const adminTeam1Yellow = document.getElementById('admin-team1-yellow');
    const adminTeam2Yellow = document.getElementById('admin-team2-yellow');
    const adminTeam1Red = document.getElementById('admin-team1-red');
    const adminTeam2Red = document.getElementById('admin-team2-red');
    const adminSetResultButton = document.getElementById('admin-set-result-button');
    const adminResultMessage = document.getElementById('admin-result-message');
    const adminButtonText = document.getElementById('admin-button-text');
    const adminButtonSpinner = document.getElementById('admin-button-spinner');
    const betButtonText = document.getElementById('bet-button-text');
    const betButtonSpinner = document.getElementById('bet-button-spinner');
    const adminPendingMatches = document.getElementById('admin-pending-matches');
    const adminActiveBets = document.getElementById('admin-active-bets');
    const adminTotalUsers = document.getElementById('admin-total-users');

    let currentUser = null;
    let isAdmin = false;
    let currentMatchOdds = {}; // Store full odds for selected match
    let selectedCombinedBets = new Map(); // Map to store selected combined bets {type: odds}

    // --- Utility Functions ---
    function showSection(id) {
        sections.forEach(section => section.classList.remove('active'));
        document.getElementById(id).classList.add('active');
        navLinks.forEach(link => link.classList.remove('active'));
        // Find the correct nav link based on the section ID
        const navId = `nav-${id.replace('-section', '')}`;
        const activeNavLink = document.getElementById(navId);
        if (activeNavLink) {
            activeNavLink.classList.add('active');
        }
    }

    function formatCurrency(amount) {
        return `${Math.round(amount).toLocaleString()}`;
    }

    function displayMessage(element, message, type) {
        element.textContent = message;
        element.className = `message ${type}`;
        setTimeout(() => {
            element.textContent = '';
            element.className = 'message';
        }, 5000);
    }

    function getTeamNameWithoutLeague(fullName) {
        if (!fullName) return 'N/A';
        return fullName.split(' (')[0];
    }

    // --- Authentication ---
    async function checkAuthStatus() {
        try {
            console.log('🔍 Checking authentication status...');
            const response = await fetch('/api/auth/status', {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            console.log('Response status:', response.status);
            
            if (!response.ok) {
                console.error('Auth status response not OK:', response.status, response.statusText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('Auth status data:', data);
            
            if (data.authenticated && data.user) {
                currentUser = data.user;
                console.log('✅ User authenticated:', currentUser.username);
                
                const avatarUrl = currentUser.avatar ? 
                    `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png?size=32` : 
                    `https://cdn.discordapp.com/embed/avatars/${parseInt(currentUser.discriminator || '0') % 5}.png`;
                    
                authStatus.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width:24px;height:24px;border-radius:50%;margin-right:8px;"> ${currentUser.username}#${currentUser.discriminator}`;
                userBalanceDisplay.textContent = `Balance: ${formatCurrency(currentUser.balance)} 💰`;
                authStatus.appendChild(userBalanceDisplay);
                authButton.style.display = 'none';
                logoutButton.style.display = 'inline-block';
                
                // Check if user is admin
                await checkAdminStatus();
                
                // Load full user data including stats
                await loadUserData();
            } else {
                console.log('❌ User not authenticated:', data);
                currentUser = null;
                isAdmin = false;
                authStatus.textContent = 'No autenticado';
                authButton.style.display = 'inline-block';
                logoutButton.style.display = 'none';
                adminNavItem.style.display = 'none';
                
                // Check URL for error parameters
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.has('error')) {
                    const errorType = urlParams.get('error');
                    let errorMessage = 'Error de autenticación';
                    
                    switch(errorType) {
                        case 'auth_failed':
                            errorMessage = 'Error en la autenticación con Discord. Inténtalo de nuevo.';
                            break;
                        case 'no_user':
                            errorMessage = 'No se pudo obtener la información del usuario de Discord.';
                            break;
                        case 'callback_error':
                            errorMessage = 'Error en el proceso de autenticación. Inténtalo de nuevo.';
                            break;
                    }
                    
                    authStatus.innerHTML = `<span style="color: #ff6b6b;">${errorMessage}</span>`;
                    
                    // Clear URL parameters after showing error
                    setTimeout(() => {
                        const url = new URL(window.location);
                        url.searchParams.delete('error');
                        window.history.replaceState({}, document.title, url.pathname);
                        authStatus.textContent = 'No autenticado';
                    }, 5000);
                }
            }
        } catch (error) {
            console.error('❌ Error checking auth status:', error);
            authStatus.innerHTML = `<span style="color: #ff6b6b;">Error de conexión</span>`;
            
            // Reset to normal after 3 seconds
            setTimeout(() => {
                authStatus.textContent = 'No autenticado';
            }, 3000);
        }
    }
    
    async function checkAdminStatus() {
        if (!currentUser) return;
        
        try {
            const response = await fetch('/api/admin/check');
            const data = await response.json();
            isAdmin = data.isAdmin;
            
            if (isAdmin) {
                adminNavItem.style.display = 'block';
                loadAdminData();
            } else {
                adminNavItem.style.display = 'none';
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
            isAdmin = false;
            adminNavItem.style.display = 'none';
        }
    }

    authButton.addEventListener('click', () => {
        window.location.href = '/auth/discord';
    });

    logoutButton.addEventListener('click', () => {
        window.location.href = '/logout';
    });

    // --- Load Data Functions ---
    // Removed loadGeneralStats as home section is removed.
    // If you need these stats elsewhere, you'll need to re-implement the call.

    async function loadUpcomingMatches() {
        try {
            const response = await fetch('/api/matches');
            const matches = await response.json();
            upcomingMatchesList.innerHTML = '';
            betMatchSelect.innerHTML = '<option value="">-- Selecciona --</option>';
            if (matches.length === 0) {
                upcomingMatchesList.innerHTML = '<p>No hay partidos próximos.</p>';
                return;
            }
            matches.forEach(match => {
                const matchCard = document.createElement('div');
                matchCard.className = 'match-card';
                matchCard.innerHTML = `
                    <h4>${getTeamNameWithoutLeague(match.team1)} vs ${getTeamNameWithoutLeague(match.team2)}</h4>
                    <p>ID: ${match.id}</p>
                    <p>Hora: ${new Date(match.matchTime).toLocaleString()}</p>
                    <div class="odds-display">
                        <div class="odds-item">
                            <span>${getTeamNameWithoutLeague(match.team1)}</span>
                            <strong>${match.odds.team1}</strong>
                        </div>
                        <div class="odds-item">
                            <span>Empate</span>
                            <strong>${match.odds.draw}</strong>
                        </div>
                        <div class="odds-item">
                            <span>${getTeamNameWithoutLeague(match.team2)}</span>
                            <strong>${match.odds.team2}</strong>
                        </div>
                    </div>
                `;
                upcomingMatchesList.appendChild(matchCard);

                const option = document.createElement('option');
                option.value = match.id;
                option.textContent = `${getTeamNameWithoutLeague(match.team1)} vs ${getTeamNameWithoutLeague(match.team2)} (${new Date(match.matchTime).toLocaleString()})`;
                betMatchSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading upcoming matches:', error);
            upcomingMatchesList.innerHTML = '<p class="message error">Error al cargar los partidos próximos.</p>';
        }
    }

    async function loadFinishedMatches() {
        try {
            const response = await fetch('/api/finished-matches');
            const matches = await response.json();
            finishedMatchesList.innerHTML = '';
            finishedMatchesList.className = 'history-grid'; // Change class for better styling
            
            if (matches.length === 0) {
                finishedMatchesList.innerHTML = '<p>No hay partidos terminados.</p>';
                return;
            }
            
            matches.forEach(match => {
                const matchCard = document.createElement('div');
                matchCard.className = 'history-card glass-card';
                
                // Parse score to get individual scores
                const scores = match.score ? match.score.split('-').map(s => s.trim()) : ['0', '0'];
                const score1 = scores[0] || '0';
                const score2 = scores[1] || '0';
                
                // Determine winner for styling
                const winnerClass = match.result === 'team1' ? 'team1-winner' : 
                                   match.result === 'team2' ? 'team2-winner' : '';
                
                // Format special events icons
                let specialEventsHTML = '';
                if (match.specialEvents) {
                    const events = [];
                    if (match.specialEvents.corner_goal) events.push('<span class="event-icon" title="Gol de córner">🚩</span>');
                    if (match.specialEvents.free_kick_goal) events.push('<span class="event-icon" title="Gol de tiro libre">⚡</span>');
                    if (match.specialEvents.bicycle_kick_goal) events.push('<span class="event-icon" title="Gol de chilena">🚴</span>');
                    if (match.specialEvents.header_goal) events.push('<span class="event-icon" title="Gol de cabeza">🎯</span>');
                    if (match.specialEvents.goalkeeper_goal) events.push('<span class="event-icon" title="Gol de arquero">🥅</span>');
                    if (match.specialEvents.total_red_cards > 0) events.push(`<span class="event-icon" title="${match.specialEvents.total_red_cards} tarjeta(s) roja(s)">🟥</span>`);
                    if (match.specialEvents.total_yellow_cards > 0) events.push(`<span class="event-icon" title="${match.specialEvents.total_yellow_cards} tarjeta(s) amarilla(s)">🟨</span>`);
                    
                    if (events.length > 0) {
                        specialEventsHTML = `<div class="history-special-events">${events.join('')}</div>`;
                    }
                }
                
                matchCard.innerHTML = `
                    <div class="history-card-header">
                        <span class="history-match-time">
                            <i class="fas fa-calendar-alt"></i>
                            ${new Date(match.matchTime).toLocaleDateString('es-ES', { 
                                weekday: 'short', 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </span>
                        <span class="history-match-id">ID: ${match.id}</span>
                    </div>
                    
                    <div class="history-card-body ${winnerClass}">
                        <div class="history-team history-team1">
                            <div class="history-team-name">${getTeamNameWithoutLeague(match.team1)}</div>
                            <div class="history-team-score">${score1}</div>
                        </div>
                        <div class="history-vs">VS</div>
                        <div class="history-team history-team2">
                            <div class="history-team-score">${score2}</div>
                            <div class="history-team-name">${getTeamNameWithoutLeague(match.team2)}</div>
                        </div>
                    </div>
                    
                    <div class="history-card-footer">
                        <div class="history-winner-info">
                            ${match.result === 'draw' ? 
                                '<span class="draw-result">⚖️ Empate</span>' : 
                                `<strong>🏆 Ganador:</strong> ${match.result === 'team1' ? getTeamNameWithoutLeague(match.team1) : getTeamNameWithoutLeague(match.team2)}`
                            }
                        </div>
                        ${specialEventsHTML}
                    </div>
                `;
                
                finishedMatchesList.appendChild(matchCard);
            });
        } catch (error) {
            console.error('Error loading finished matches:', error);
            finishedMatchesList.innerHTML = '<p class="message error">Error al cargar los partidos terminados.</p>';
        }
    }

    async function loadUserData() {
        if (!currentUser) return;
        try {
            const response = await fetch('/api/user/stats');
            const data = await response.json();
            currentUser = { ...currentUser, ...data }; // Update current user data
            userBalanceDisplay.textContent = `Balance: ${formatCurrency(currentUser.balance)} 💰`;

            // Update Profile Section
            profileUserAvatar.src = `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png?size=128`;
            profileUsername.textContent = `${currentUser.username}#${currentUser.discriminator}`;
            profileBalance.textContent = `${formatCurrency(currentUser.balance)} 💰`;
            profileTotalBets.textContent = currentUser.totalBets;
            profileWonBets.textContent = currentUser.wonBets;
            profileLostBets.textContent = currentUser.lostBets;
            profileNetWinnings.textContent = `${formatCurrency(currentUser.totalWinnings - (currentUser.totalBets - currentUser.lostBets) * (currentUser.totalWinnings / currentUser.wonBets || 0))} 💰`; // Simplified net winnings
            profileWinRate.textContent = `${currentUser.winRate}%`;

            loadMyBets(); // Load user's bets for profile section
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async function loadMyBets() {
        if (!currentUser) {
            myBetsList.innerHTML = '<p class="message error">Debes iniciar sesión para ver tus apuestas.</p>';
            return;
        }
        try {
            const response = await fetch('/api/user/bets');
            const bets = await response.json();
            myBetsList.innerHTML = '';
            if (bets.length === 0) {
                myBetsList.innerHTML = '<p>No has realizado ninguna apuesta aún.</p>';
                return;
            }
            bets.forEach(bet => {
                const betItem = document.createElement('div');
                betItem.className = 'bet-item';
                const statusClass = bet.status === 'won' ? 'status-won' : bet.status === 'lost' ? 'status-lost' : 'status-pending';
                const matchResult = bet.match.result ? `Resultado: ${bet.match.score} (${bet.match.result === 'team1' ? getTeamNameWithoutLeague(bet.match.team1) : bet.match.result === 'team2' ? getTeamNameWithoutLeague(bet.match.team2) : 'Empate'})` : '';
                betItem.innerHTML = `
                    <strong>${getTeamNameWithoutLeague(bet.match.team1)} vs ${getTeamNameWithoutLeague(bet.match.team2)}</strong><br>
                    <p>Predicción: ${bet.predictionText}</p>
                    <p>Cantidad: ${formatCurrency(bet.amount)} 💰 | Cuota: ${bet.odds} | Ganancia Potencial: ${formatCurrency(bet.potentialWinning)} 💰</p>
                    <p>Estado: <span class="${statusClass}">${bet.status.toUpperCase()}</span> ${matchResult}</p>
                `;
                myBetsList.appendChild(betItem);
            });
        } catch (error) {
            console.error('Error loading my bets:', error);
            myBetsList.innerHTML = '<p class="message error">Error al cargar tus apuestas.</p>';
        }
    }

    async function loadLeaderboard() {
        try {
            const response = await fetch('/api/top-users');
            const users = await response.json();
            leaderboardTableBody.innerHTML = '';
            
            // Actualizar el podio (top 3)
            if (users.length >= 3) {
                // Primer lugar
                const first = users[0];
                const firstAvatar = document.getElementById('podium-1-avatar');
                if (firstAvatar) {
                    firstAvatar.src = first.avatar ? 
                        `https://cdn.discordapp.com/avatars/${first.id}/${first.avatar}.png?size=128` : 
                        `https://cdn.discordapp.com/embed/avatars/${parseInt(first.discriminator) % 5}.png`;
                    firstAvatar.onerror = function() {
                        this.src = `https://cdn.discordapp.com/embed/avatars/${parseInt(first.discriminator || '0') % 5}.png`;
                    };
                }
                const firstName = document.getElementById('podium-1-name');
                if (firstName) firstName.textContent = first.username || 'Usuario';
                const firstScore = document.getElementById('podium-1-score');
                if (firstScore) firstScore.textContent = `${formatCurrency(first.balance)} 💰`;
                
                // Segundo lugar
                const second = users[1];
                const secondAvatar = document.getElementById('podium-2-avatar');
                if (secondAvatar) {
                    secondAvatar.src = second.avatar ? 
                        `https://cdn.discordapp.com/avatars/${second.id}/${second.avatar}.png?size=128` : 
                        `https://cdn.discordapp.com/embed/avatars/${parseInt(second.discriminator) % 5}.png`;
                    secondAvatar.onerror = function() {
                        this.src = `https://cdn.discordapp.com/embed/avatars/${parseInt(second.discriminator || '0') % 5}.png`;
                    };
                }
                const secondName = document.getElementById('podium-2-name');
                if (secondName) secondName.textContent = second.username || 'Usuario';
                const secondScore = document.getElementById('podium-2-score');
                if (secondScore) secondScore.textContent = `${formatCurrency(second.balance)} 💰`;
                
                // Tercer lugar
                const third = users[2];
                const thirdAvatar = document.getElementById('podium-3-avatar');
                if (thirdAvatar) {
                    thirdAvatar.src = third.avatar ? 
                        `https://cdn.discordapp.com/avatars/${third.id}/${third.avatar}.png?size=128` : 
                        `https://cdn.discordapp.com/embed/avatars/${parseInt(third.discriminator) % 5}.png`;
                    thirdAvatar.onerror = function() {
                        this.src = `https://cdn.discordapp.com/embed/avatars/${parseInt(third.discriminator || '0') % 5}.png`;
                    };
                }
                const thirdName = document.getElementById('podium-3-name');
                if (thirdName) thirdName.textContent = third.username || 'Usuario';
                const thirdScore = document.getElementById('podium-3-score');
                if (thirdScore) thirdScore.textContent = `${formatCurrency(third.balance)} 💰`;
            }
            
            // Llenar la tabla
            if (users.length === 0) {
                leaderboardTableBody.innerHTML = '<tr><td colspan="5">No hay usuarios en la clasificación.</td></tr>';
                return;
            }
            
            users.forEach((user, index) => {
                const row = leaderboardTableBody.insertRow();
                const avatarUrl = user.avatar ? 
                    `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=32` : 
                    `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;
                    
                row.innerHTML = `
                    <td>${index + 1}</td>
                    <td>
                        <img src="${avatarUrl}" 
                             alt="Avatar" 
                             style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-right:8px;border:2px solid var(--primary-color);" 
                             onerror="this.src='https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png'">
                        ${user.username || 'Usuario'}#${user.discriminator || '0000'}
                    </td>
                    <td>${formatCurrency(user.balance)} 💰</td>
                    <td>${user.wonBets || 0}</td>
                    <td>${user.winRate || 0}%</td>
                `;
            });
        } catch (error) {
            console.error('Error loading leaderboard:', error);
            leaderboardTableBody.innerHTML = '<tr><td colspan="5" class="message error">Error al cargar la clasificación.</td></tr>';
        }
    }

    // --- Betting Logic ---
    betMatchSelect.addEventListener('change', async (event) => {
        const matchId = event.target.value;
        if (!matchId) {
            selectedMatchDetails.style.display = 'none';
            // Hide all odds containers and bet options
            basicOddsContainer.style.display = 'none';
            specialOddsContainer.style.display = 'none';
            specialCombinedCheckboxes.style.display = 'none';
            simpleBetOptions.style.display = 'none';
            specialBetOptions.style.display = 'none';
            specialCombinedBetOptions.style.display = 'none';
            return;
        }
        try {
            const response = await fetch(`/api/match/odds/${matchId}`);
            const data = await response.json();
            currentMatchOdds = data; // Store full odds data

            betMatchId.textContent = data.match.id;
            betMatchTeams.textContent = `${getTeamNameWithoutLeague(data.match.team1)} vs ${getTeamNameWithoutLeague(data.match.team2)}`;
            betMatchTime.textContent = new Date(data.match.matchTime).toLocaleString();
            selectedMatchDetails.style.display = 'block';

            // Reset bet form and show default options
            betTypeSelect.value = 'simple';
            selectedCombinedBets.clear(); // Clear combined bets
            toggleBetOptions(); // This will now also render the correct odds container
            betAmountInput.value = 100;
            betMessage.textContent = '';
            updatePotentialWinnings(); // Update calculator
        } catch (error) {
            console.error('Error loading match odds:', error);
            displayMessage(betMessage, 'Error al cargar las cuotas del partido.', 'error');
            selectedMatchDetails.style.display = 'none';
        }
    });

    function renderBasicOdds(odds, team1FullName, team2FullName) {
        basicOddsContainer.innerHTML = '';
        simplePredictionSelect.innerHTML = ''; // Clear previous options
        const team1Name = getTeamNameWithoutLeague(team1FullName);
        const team2Name = getTeamNameWithoutLeague(team2FullName);

        const options = [
            { prediction: 'team1', label: team1Name, odds: odds.team1 },
            { prediction: 'draw', label: 'Empate', odds: odds.draw },
            { prediction: 'team2', label: team2Name, odds: odds.team2 }
        ];

        options.forEach(opt => {
            const div = document.createElement('div');
            div.className = 'odds-option';
            div.dataset.prediction = opt.prediction;
            div.dataset.odds = opt.odds;
            div.innerHTML = `<span>${opt.label}</span><strong>${opt.odds}</strong>`;
            div.addEventListener('click', () => selectBasicOdds(opt.prediction, opt.odds));
            basicOddsContainer.appendChild(div);

            const option = document.createElement('option');
            option.value = opt.prediction;
            option.textContent = `${opt.label} (${opt.odds})`;
            option.dataset.odds = opt.odds; // Store odds in dataset for easy retrieval
            simplePredictionSelect.appendChild(option);
        });
        // Select the first option by default and update displayed odds
        if (options.length > 0) {
            selectBasicOdds(options[0].prediction, options[0].odds);
        } else {
            simpleSelectedOdds.textContent = 'N/A';
        }
    }

    function selectBasicOdds(prediction, odds) {
        document.querySelectorAll('#basic-odds-container .odds-option').forEach(el => el.classList.remove('selected'));
        const selectedDiv = document.querySelector(`#basic-odds-container .odds-option[data-prediction="${prediction}"]`);
        if (selectedDiv) selectedDiv.classList.add('selected');
        simplePredictionSelect.value = prediction;
        simpleSelectedOdds.textContent = odds;
        updatePotentialWinnings();
    }

    function renderSpecialOdds(specialOdds) {
        specialOddsContainer.innerHTML = '';
        specialCombinedCheckboxes.innerHTML = ''; // Asegúrate de que este elemento esté vacío si no se usa directamente aquí

        const specialNames = {
            'both_teams_score': 'Ambos marcan',
            'total_goals_over_2_5': 'Más de 2.5 goles',
            'total_goals_under_2_5': 'Menos de 2.5 goles',
            'home_goals_over_1_5': `Más de 1.5 goles ${getTeamNameWithoutLeague(currentMatchOdds.match.team1)}`,
            'away_goals_over_1_5': `Más de 1.5 goles ${getTeamNameWithoutLeague(currentMatchOdds.match.team2)}`,
            'total_corners_over_1_5': 'Más de 1.5 córners',
            'total_corners_over_2_5': 'Más de 2.5 córners',
            'total_corners_over_3_5': 'Más de 3.5 córners',
            'total_corners_over_4_5': 'Más de 4.5 córners',
            'total_corners_over_5_5': 'Más de 5.5 córners',
            'total_corners_over_6_5': 'Más de 6.5 córners',
            'total_corners_over_7_5': 'Más de 7.5 córners',
            'total_corners_over_8_5': 'Más de 8.5 córners',
            'total_corners_under_1_5': 'Menos de 1.5 córners',
            'total_corners_under_2_5': 'Menos de 2.5 córners',
            'total_corners_under_3_5': 'Menos de 3.5 córners',
            'corner_goal': 'Gol de córner',
            'free_kick_goal': 'Gol de tiro libre',
            'bicycle_kick_goal': 'Gol de chilena',
            'header_goal': 'Gol de cabeza',
            'striker_goal': 'Gol de delantero',
            'midfielder_goal': 'Gol de mediocampista',
            'defender_goal': 'Gol de defensa',
            'goalkeeper_goal': 'Gol de arquero',
            // --- Nuevos nombres para tarjetas ---
            'total_yellow_cards_over_2_5': 'Más de 2.5 amarillas totales',
            'total_yellow_cards_over_3_5': 'Más de 3.5 amarillas totales',
            'total_yellow_cards_over_4_5': 'Más de 4.5 amarillas totales',
            'total_red_cards_yes': 'Habrá tarjeta roja',
            'total_red_cards_no': 'No habrá tarjeta roja',
            'team1_yellow_cards_over_1_5': `Más de 1.5 amarillas ${getTeamNameWithoutLeague(currentMatchOdds.match.team1)}`,
            'team2_yellow_cards_over_1_5': `Más de 1.5 amarillas ${getTeamNameWithoutLeague(currentMatchOdds.match.team2)}`,
            'team1_red_card_yes': `Roja para ${getTeamNameWithoutLeague(currentMatchOdds.match.team1)}`,
            'team2_red_card_yes': `Roja para ${getTeamNameWithoutLeague(currentMatchOdds.match.team2)}`,
        };

        const categories = {
            'Goles': {
                types: ['both_teams_score', 'total_goals_over_2_5', 'total_goals_under_2_5'],
                exclusive: ['total_goals_over_2_5', 'total_goals_under_2_5'] // Solo uno de estos
            },
            'Goles por Equipo': {
                types: ['home_goals_over_1_5', 'away_goals_over_1_5'],
                exclusive: [] // Pueden ser ambos
            },
            'Córners': {
                types: [
                    'total_corners_over_1_5', 'total_corners_over_2_5', 'total_corners_over_3_5', 'total_corners_over_4_5',
                    'total_corners_over_5_5', 'total_corners_over_6_5', 'total_corners_over_7_5', 'total_corners_over_8_5',
                    'total_corners_under_1_5', 'total_corners_under_2_5', 'total_corners_under_3_5'
                ],
                exclusive: [ // Solo uno de estos
                    'total_corners_over_1_5', 'total_corners_over_2_5', 'total_corners_over_3_5', 'total_corners_over_4_5',
                    'total_corners_over_5_5', 'total_corners_over_6_5', 'total_corners_over_7_5', 'total_corners_over_8_5',
                    'total_corners_under_1_5', 'total_corners_under_2_5', 'total_corners_under_3_5'
                ]
            },
            'Eventos de Gol': {
                types: ['corner_goal', 'free_kick_goal', 'bicycle_kick_goal', 'header_goal', 'striker_goal', 'midfielder_goal', 'defender_goal', 'goalkeeper_goal'],
                exclusive: [] // Pueden ser varios
            },
            // --- Nuevas categorías para tarjetas ---
            'Tarjetas Amarillas Totales': {
                types: ['total_yellow_cards_over_2_5', 'total_yellow_cards_over_3_5', 'total_yellow_cards_over_4_5'],
                exclusive: ['total_yellow_cards_over_2_5', 'total_yellow_cards_over_3_5', 'total_yellow_cards_over_4_5'] // Solo uno
            },
            'Tarjetas Rojas Totales': {
                types: ['total_red_cards_yes', 'total_red_cards_no'],
                exclusive: ['total_red_cards_yes', 'total_red_cards_no'] // Solo uno
            },
            'Tarjetas Amarillas por Equipo': {
                types: ['team1_yellow_cards_over_1_5', 'team2_yellow_cards_over_1_5'],
                exclusive: [] // Pueden ser ambos
            },
            'Tarjetas Rojas por Equipo': {
                types: ['team1_red_card_yes', 'team2_red_card_yes'],
                exclusive: [] // Pueden ser ambos
            }
        };

        for (const categoryName in categories) {
            const categoryConfig = categories[categoryName];
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'special-odds-category';
            categoryDiv.innerHTML = `<h3>${categoryName}</h3>`;
            const categoryGrid = document.createElement('div');
            categoryGrid.className = 'odds-grid special-bets-grid';

            categoryConfig.types.forEach(type => {
                if (specialOdds[type]) {
                    const odds = specialOdds[type];
                    const label = specialNames[type] || type;

                    const div = document.createElement('div');
                    div.className = 'odds-option checkbox-option';
                    div.innerHTML = `
                        <label>
                            <input type="checkbox" data-type="${type}" data-odds="${odds}" data-category="${categoryName}">
                            <div class="odds-content">
                                <span>${label}</span>
                                <strong>${odds}</strong>
                            </div>
                        </label>
                    `;

                    const checkbox = div.querySelector('input');
                    checkbox.addEventListener('change', (e) => {
                        const changedType = e.target.dataset.type;
                        const changedCategory = e.target.dataset.category;
                        const isChecked = e.target.checked;

                        if (isChecked) {
                            // Aplicar exclusividad dentro de la categoría
                            if (categoryConfig.exclusive.includes(changedType)) {
                                document.querySelectorAll(`input[type="checkbox"][data-category="${changedCategory}"]`).forEach(otherCheckbox => {
                                    if (otherCheckbox !== e.target && otherCheckbox.checked) {
                                        otherCheckbox.checked = false;
                                        selectedCombinedBets.delete(otherCheckbox.dataset.type);
                                        otherCheckbox.closest('.checkbox-option').classList.remove('selected');
                                    }
                                });
                            }
                            selectedCombinedBets.set(changedType, parseFloat(e.target.dataset.odds));
                            div.classList.add('selected');
                        } else {
                            selectedCombinedBets.delete(changedType);
                            div.classList.remove('selected');
                        }
                        updateCombinedOdds();
                        updatePotentialWinnings();
                    });

                    categoryGrid.appendChild(div);
                }
            });
            categoryDiv.appendChild(categoryGrid);
            specialOddsContainer.appendChild(categoryDiv);
        }

        combinedSelectedOdds.textContent = 'N/A';
        updatePotentialWinnings();
    }


    function selectSpecialOdds(type, odds) {
        document.querySelectorAll('#special-odds-container .odds-option').forEach(el => el.classList.remove('selected'));
        const selectedDiv = document.querySelector(`#special-odds-container .odds-option[data-type="${type}"]`);
        if (selectedDiv) selectedDiv.classList.add('selected');
        specialTypeSelect.value = type;
        specialSelectedOdds.textContent = odds;
        updatePotentialWinnings();
    }

    function updateCombinedOdds() {
        let totalCombinedOdds = 1.0;
        if (selectedCombinedBets.size === 0) {
            combinedSelectedOdds.textContent = 'N/A';
            return;
        }
        selectedCombinedBets.forEach(odds => {
            totalCombinedOdds *= odds;
        });
        combinedSelectedOdds.textContent = totalCombinedOdds.toFixed(2);
    }

    betTypeSelect.addEventListener('change', toggleBetOptions);

    // Event listeners for select changes to update displayed odds
    simplePredictionSelect.addEventListener('change', (event) => {
        const selectedOption = event.target.options[event.target.selectedIndex];
        simpleSelectedOdds.textContent = selectedOption.dataset.odds || 'N/A';
        document.querySelectorAll('#basic-odds-container .odds-option').forEach(el => el.classList.remove('selected'));
        if (selectedOption.value) {
            const selectedDiv = document.querySelector(`#basic-odds-container .odds-option[data-prediction="${selectedOption.value}"]`);
            if (selectedDiv) selectedDiv.classList.add('selected');
        }
        updatePotentialWinnings();
    });

    specialTypeSelect.addEventListener('change', (event) => {
        const selectedOption = event.target.options[event.target.selectedIndex];
        specialSelectedOdds.textContent = selectedOption.dataset.odds || 'N/A';
        document.querySelectorAll('#special-odds-container .odds-option').forEach(el => el.classList.remove('selected'));
        if (selectedOption.value) {
            const selectedDiv = document.querySelector(`#special-odds-container .odds-option[data-type="${selectedOption.value}"]`);
            if (selectedDiv) selectedDiv.classList.add('selected');
        }
        updatePotentialWinnings();
    });

    betAmountInput.addEventListener('input', updatePotentialWinnings);

    function updatePotentialWinnings() {
        const amount = parseFloat(betAmountInput.value);
        let currentOdds = 0;

        switch (betTypeSelect.value) {
            case 'simple':
                currentOdds = parseFloat(simpleSelectedOdds.textContent) || 0;
                break;
            case 'special':
                currentOdds = parseFloat(specialSelectedOdds.textContent) || 0;
                break;
            case 'special_combined':
                currentOdds = parseFloat(combinedSelectedOdds.textContent) || 0;
                break;
        }

        const potential = isNaN(amount) ? 0 : amount * currentOdds;
        potentialWinningsDisplay.textContent = `${formatCurrency(potential)} 💰`;
    }

    function toggleBetOptions() {
    // Hide all bet option groups and odds containers first
    simpleBetOptions.style.display = 'none';
    specialCombinedBetOptions.style.display = 'none';

    basicOddsContainer.style.display = 'none';
    specialOddsContainer.style.display = 'none';
    specialCombinedCheckboxes.style.display = 'none';

    switch (betTypeSelect.value) {
        case 'simple':
            simpleBetOptions.style.display = 'block';
            basicOddsContainer.style.display = 'grid';
            renderBasicOdds(currentMatchOdds.basicOdds, currentMatchOdds.match.team1, currentMatchOdds.match.team2);
            break;
        case 'special_combined':
            specialCombinedBetOptions.style.display = 'block';
            specialCombinedCheckboxes.style.display = 'grid';
            specialOddsContainer.style.display = 'block';
            renderSpecialOdds(currentMatchOdds.specialOdds);
            break;
    }
    updatePotentialWinnings();
}


   placeBetButton.addEventListener('click', async () => {
       if (!currentUser) {
           displayMessage(betMessage, 'Debes iniciar sesión para apostar.', 'error');
           return;
       }

       const matchId = betMatchSelect.value;
       const amount = parseFloat(betAmountInput.value);
       let betData = {};
       let endpoint = '/api/bet';

       if (!matchId) {
           displayMessage(betMessage, 'Por favor, selecciona un partido.', 'error');
           return;
       }
       if (isNaN(amount) || amount <= 0) {
           displayMessage(betMessage, 'La cantidad a apostar debe ser un número positivo.', 'error');
           return;
       }
       if (amount > currentUser.balance) {
           displayMessage(betMessage, `No tienes suficiente dinero. Tu balance actual es ${formatCurrency(currentUser.balance)} 💰.`, 'error');
           return;
       }
       
       // Show loading animation
       placeBetButton.disabled = true;
       betButtonText.style.display = 'none';
       betButtonSpinner.style.display = 'inline-block';

       switch (betTypeSelect.value) {
           case 'simple':
               const prediction = simplePredictionSelect.value;
               if (!prediction) { displayMessage(betMessage, 'Selecciona una predicción para la apuesta simple.', 'error'); return; }
               betData = { matchId, prediction, amount };
               break;
           case 'special_combined':
               if (selectedCombinedBets.size < 1) { // Ahora puede ser 1 si es solo "Ambos marcan"
                   displayMessage(betMessage, 'Selecciona al menos una apuesta especial para combinar.', 'error');
                   return;
               }

               const combinedSpecialTypes = Array.from(selectedCombinedBets.keys());

               // --- Validaciones de restricciones en el cliente ---
               const goalBets = combinedSpecialTypes.filter(type => type.startsWith('total_goals_') || type.startsWith('home_goals_') || type.startsWith('away_goals_'));
               const cornerBets = combinedSpecialTypes.filter(type => type.startsWith('total_corners_'));
               const yellowCardBets = combinedSpecialTypes.filter(type => type.startsWith('total_yellow_cards_') || type.startsWith('team1_yellow_cards_') || type.startsWith('team2_yellow_cards_'));
               const redCardBets = combinedSpecialTypes.filter(type => type.startsWith('total_red_cards_') || type.startsWith('team1_red_card_') || type.startsWith('team2_red_card_'));

               if (goalBets.length > 1) {
                   displayMessage(betMessage, 'No se puede combinar más de una apuesta de goles (Más/Menos de X.5 goles).', 'error'); return;
               }
               if (cornerBets.length > 1) {
                   displayMessage(betMessage, 'No se puede combinar más de una apuesta de córners (Más/Menos de X.5 córners).', 'error'); return;
               }
               if (yellowCardBets.length > 1) {
                   displayMessage(betMessage, 'No se puede combinar más de una apuesta de tarjetas amarillas.', 'error'); return;
               }
               if (redCardBets.length > 1) {
                   displayMessage(betMessage, 'No se puede combinar más de una apuesta de tarjetas rojas.', 'error'); return;
               }

               const bothTeamsScoreBet = combinedSpecialTypes.includes('both_teams_score');
               const otherCombinedBetsCount = (goalBets.length > 0 ? 1 : 0) + (cornerBets.length > 0 ? 1 : 0) + (yellowCardBets.length > 0 ? 1 : 0) + (redCardBets.length > 0 ? 1 : 0);

               if (bothTeamsScoreBet && otherCombinedBetsCount > 1) {
                   displayMessage(betMessage, 'La apuesta "Ambos equipos marcan" solo se puede combinar con una única apuesta de goles, córners o tarjetas.', 'error'); return;
               }
               // --- Fin de validaciones de restricciones en el cliente ---

               betData = { matchId, betType: 'special_combined', amount, data: { specialBets: combinedSpecialTypes } };
               endpoint = '/api/bet/special';
               break;
           default:
               displayMessage(betMessage, 'Tipo de apuesta no válido.', 'error');
               return;
       }

       try {
           const response = await fetch(endpoint, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(betData)
           });
           const result = await response.json();
           if (result.success) {
               displayMessage(betMessage, `¡Apuesta realizada con éxito! Ganancia potencial: ${formatCurrency(result.bet.potentialWinning)} 💰. Nuevo balance: ${formatCurrency(result.newBalance)} 💰.`, 'success');
               currentUser.balance = result.newBalance;
               userBalanceDisplay.textContent = `Balance: ${formatCurrency(currentUser.balance)} 💰`;
               loadUserData();
           } else {
               displayMessage(betMessage, `Error al realizar la apuesta: ${result.error}`, 'error');
           }
       } catch (error) {
           console.error('Error placing bet:', error);
           displayMessage(betMessage, 'Error de conexión al intentar apostar.', 'error');
       } finally {
           // Hide loading animation
           placeBetButton.disabled = false;
           betButtonText.style.display = 'inline';
           betButtonSpinner.style.display = 'none';
       }
   });

    // --- Navigation ---
    navLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            // Obtener el ID correcto del link clickeado
            const linkElement = event.target.closest('.nav-link');
            if (!linkElement) return;
            
            const sectionId = `${linkElement.id.replace('nav-', '')}-section`;
            showSection(sectionId);
            
            // Load data specific to the section when navigated
            if (sectionId === 'profile-section') {
                loadUserData(); // Reload user data and my bets for profile section
            } else if (sectionId === 'leaderboard-section') {
                loadLeaderboard();
            } else if (sectionId === 'finished-matches-section') {
                loadFinishedMatches();
            } else if (sectionId === 'matches-section') {
                loadUpcomingMatches();
            } else if (sectionId === 'betting-section') {
                loadUpcomingMatches(); // Reload matches for betting select
            } else if (sectionId === 'admin-section') {
                if (isAdmin) {
                    loadAdminData();
                } else {
                    showSection('matches-section');
                    displayMessage(document.createElement('div'), 'No tienes permisos de administrador.', 'error');
                }
            }
        });
    });

    // --- Socket.io Real-time Updates ---
    socket.on('initial-data', (data) => {
        console.log('Initial data received from socket:', data);
        // loadGeneralStats(); // If re-implemented
        loadUpcomingMatches();
        loadFinishedMatches();
    });

    socket.on('update', (data) => {
        console.log('Real-time update received:', data);
        if (data.type === 'new-bet') {
            // loadGeneralStats(); // Update general stats (total bets, volume) if re-implemented
            if (currentUser) loadUserData(); // Update user's balance and bets if logged in
        } else if (data.type === 'match-result') {
            loadUpcomingMatches(); // Remove finished match from upcoming
            loadFinishedMatches(); // Add to finished matches
            // loadGeneralStats(); // Update general stats if re-implemented
            loadLeaderboard(); // Update leaderboard (balances change)
            if (currentUser) loadUserData(); // Update user's balance and bets if logged in
        }
    });

    // --- Mobile Menu Toggle ---
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mainNavigation = document.querySelector('.main-navigation');
    
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
            mainNavigation.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
        });
    }
    
    // Cerrar menú móvil al hacer clic en un enlace
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (mainNavigation.classList.contains('active')) {
                mainNavigation.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            }
        });
    });
    
    // --- Loading States ---
    function showLoadingState(container, message = 'Cargando...') {
        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>${message}</p>
            </div>
        `;
    }
    
    // Aplicar estados de carga iniciales
    showLoadingState(upcomingMatchesList, 'Cargando partidos próximos...');
    showLoadingState(finishedMatchesList, 'Cargando partidos terminados...');
    
    // --- Admin Functions ---
    async function loadAdminData() {
        if (!isAdmin) return;
        
        try {
            // Load pending matches for admin
            const pendingResponse = await fetch('/api/pending-matches');
            const pendingMatches = await pendingResponse.json();
            
            // Update admin stats
            adminPendingMatches.textContent = pendingMatches.length;
            
            // Populate admin match select
            adminMatchSelect.innerHTML = '<option value="">-- Selecciona un partido --</option>';
            pendingMatches.forEach(match => {
                const option = document.createElement('option');
                option.value = match.id;
                option.textContent = `${match.team1} vs ${match.team2} - ${new Date(match.matchTime).toLocaleString()}`;
                option.dataset.team1 = match.team1;
                option.dataset.team2 = match.team2;
                option.dataset.time = match.matchTime;
                option.dataset.betsCount = match.betsCount;
                adminMatchSelect.appendChild(option);
            });
            
            // Load general stats
            const statsResponse = await fetch('/api/stats/general');
            const stats = await statsResponse.json();
            
            adminActiveBets.textContent = stats.activeBets || 0;
            adminTotalUsers.textContent = stats.totalUsers || 0;
            
        } catch (error) {
            console.error('Error loading admin data:', error);
        }
    }
    
    // Admin match selection handler
    if (adminMatchSelect) {
        adminMatchSelect.addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            
            if (selectedOption.value) {
                adminMatchDetails.style.display = 'block';
                adminMatchId.textContent = selectedOption.value;
                adminMatchTeams.textContent = `${selectedOption.dataset.team1} vs ${selectedOption.dataset.team2}`;
                adminMatchTime.textContent = new Date(selectedOption.dataset.time).toLocaleString();
                adminMatchBetsCount.textContent = selectedOption.dataset.betsCount || 0;
                adminTeam1Label.textContent = selectedOption.dataset.team1;
                adminTeam2Label.textContent = selectedOption.dataset.team2;
                
                // Update radio button to select winner based on score
                adminScore1.addEventListener('input', updateResultRadio);
                adminScore2.addEventListener('input', updateResultRadio);
            } else {
                adminMatchDetails.style.display = 'none';
            }
        });
    }
    
    function updateResultRadio() {
        const score1 = parseInt(adminScore1.value) || 0;
        const score2 = parseInt(adminScore2.value) || 0;
        
        const resultRadios = document.querySelectorAll('input[name="admin-result"]');
        if (score1 > score2) {
            resultRadios[0].checked = true; // team1
        } else if (score2 > score1) {
            resultRadios[2].checked = true; // team2
        } else {
            resultRadios[1].checked = true; // draw
        }
    }
    
    // Admin set result handler
    if (adminSetResultButton) {
        adminSetResultButton.addEventListener('click', async () => {
            const matchId = adminMatchSelect.value;
            const result = document.querySelector('input[name="admin-result"]:checked')?.value;
            const score1 = parseInt(adminScore1.value) || 0;
            const score2 = parseInt(adminScore2.value) || 0;
            
            if (!matchId) {
                displayMessage(adminResultMessage, 'Por favor, selecciona un partido.', 'error');
                return;
            }
            
            if (!result) {
                displayMessage(adminResultMessage, 'Por favor, selecciona el resultado del partido.', 'error');
                return;
            }
            
            // Show loading animation
            adminSetResultButton.disabled = true;
            adminButtonText.style.display = 'none';
            adminButtonSpinner.style.display = 'inline-block';
            
            // Collect special events
            const specialEvents = [];
            const eventCheckboxes = document.querySelectorAll('.special-events input[type="checkbox"]:checked');
            eventCheckboxes.forEach(checkbox => {
                specialEvents.push(checkbox.value);
            });
            
            // Collect additional stats
            const additionalStats = {};
            
            const corners = parseInt(adminCorners.value);
            if (!isNaN(corners)) additionalStats.total_corners = corners;
            
            const yellowCards = parseInt(adminYellowCards.value);
            if (!isNaN(yellowCards)) additionalStats.total_yellow_cards = yellowCards;
            
            const redCards = parseInt(adminRedCards.value);
            if (!isNaN(redCards)) additionalStats.total_red_cards = redCards;
            
            const team1Yellow = parseInt(adminTeam1Yellow.value);
            if (!isNaN(team1Yellow)) additionalStats.team1_yellow_cards = team1Yellow;
            
            const team2Yellow = parseInt(adminTeam2Yellow.value);
            if (!isNaN(team2Yellow)) additionalStats.team2_yellow_cards = team2Yellow;
            
            if (adminTeam1Red.checked) additionalStats.team1_red_card = true;
            if (adminTeam2Red.checked) additionalStats.team2_red_card = true;
            
            // Transform special events to the format expected by backend
            const specialResults = {};
            specialEvents.forEach(event => {
                switch(event) {
                    case 'corner': specialResults.corner_goal = true; break;
                    case 'libre': specialResults.free_kick_goal = true; break;
                    case 'chilena': specialResults.bicycle_kick_goal = true; break;
                    case 'cabeza': specialResults.header_goal = true; break;
                    case 'delantero': specialResults.striker_goal = true; break;
                    case 'medio': specialResults.midfielder_goal = true; break;
                    case 'defensa': specialResults.defender_goal = true; break;
                    case 'arquero': specialResults.goalkeeper_goal = true; break;
                }
            });
            
            // Merge additional stats into specialResults
            Object.assign(specialResults, additionalStats);
            
            try {
                const response = await fetch('/api/set-result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        matchId,
                        result,
                        score1,
                        score2,
                        specialEvents: specialResults,
                        additionalStats: {}
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    displayMessage(adminResultMessage, '¡Resultado establecido con éxito!', 'success');
                    
                    // Reset form
                    adminMatchSelect.value = '';
                    adminMatchDetails.style.display = 'none';
                    document.querySelectorAll('input[name="admin-result"]').forEach(r => r.checked = false);
                    adminScore1.value = '0';
                    adminScore2.value = '0';
                    document.querySelectorAll('.special-events input[type="checkbox"]').forEach(c => c.checked = false);
                    adminCorners.value = '';
                    adminYellowCards.value = '';
                    adminRedCards.value = '';
                    adminTeam1Yellow.value = '';
                    adminTeam2Yellow.value = '';
                    adminTeam1Red.checked = false;
                    adminTeam2Red.checked = false;
                    
                    // Reload data
                    loadAdminData();
                    loadUpcomingMatches();
                    loadFinishedMatches();
                } else {
                    displayMessage(adminResultMessage, `Error: ${data.error}`, 'error');
                }
            } catch (error) {
                console.error('Error setting result:', error);
                displayMessage(adminResultMessage, 'Error de conexión al establecer el resultado.', 'error');
            } finally {
                // Hide loading animation
                adminSetResultButton.disabled = false;
                adminButtonText.style.display = 'inline';
                adminButtonSpinner.style.display = 'none';
            }
        });
    }
    
    // --- Initial Load ---
    checkAuthStatus();
    // loadGeneralStats(); // If re-implemented
    loadUpcomingMatches();
    loadFinishedMatches();
    showSection('matches-section'); // Show matches section by default
});
