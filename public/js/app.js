// app.js — Main game logic, Socket.IO, screen routing

(function () {
  'use strict';

  // ---- State ----
  const state = {
    socket: null,
    playerName: '',
    mode: null, // 'solo' | 'multi'
    room: null,
    isHost: false,
    gameActive: false,
    clicks: 0,
    path: [],
    startTime: null,
    timerInterval: null,
    targetTitle: '',
    currentArticle: '',
    searchDebounce: null,
    soloCustomStart: null,
    soloCustomTarget: null,
    customStart: null,
    customTarget: null,
    timeLimit: 0,
    timeRemaining: 0,
    serverTimeOffset: 0,
  };

  // ---- Init ----
  function init() {
    // Load saved name
    const savedName = localStorage.getItem('wikirace-name');
    if (savedName) {
      document.getElementById('player-name').value = savedName;
    }

    connectSocket();
    bindEvents();
  }

  // ---- Socket Connection ----
  function connectSocket() {
    state.socket = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    state.socket.on('connect', () => {
      console.log('[Socket] Connected:', state.socket.id);
    });

    state.socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      UI.toast('Connection lost. Reconnecting...', 'error');
    });

    state.socket.on('reconnect', () => {
      UI.toast('Reconnected!', 'success');
    });

    // ---- Room Events ----
    state.socket.on('player-joined', (roomInfo) => {
      state.room = roomInfo;
      renderLobby();
      const newPlayer = roomInfo.players[roomInfo.players.length - 1];
      if (newPlayer) UI.toast(`${newPlayer.name} joined!`, 'info');
    });

    state.socket.on('player-left', (roomInfo) => {
      state.room = roomInfo;
      state.isHost = roomInfo.hostId === state.socket.id;
      renderLobby();
      UI.toast('A player left the room', 'info');
    });

    state.socket.on('player-disconnected', (roomInfo) => {
      state.room = roomInfo;
      if (state.gameActive) {
        updateSidebar();
      } else {
        renderLobby();
      }
    });

    state.socket.on('settings-updated', (roomInfo) => {
      state.room = roomInfo;
      renderLobby();
    });

    state.socket.on('teams-updated', (roomInfo) => {
      state.room = roomInfo;
      renderLobby();
    });

    // ---- Game Events ----
    state.socket.on('game-starting', async (data) => {
      state.targetTitle = data.targetArticle;
      UI.showScreen('screen-game');
      await UI.showCountdown(data.startArticle, data.targetArticle);
    });

    state.socket.on('game-started', (data) => {
      startGame(data, 'multi');
    });

    state.socket.on('player-progress', (data) => {
      if (state.room) {
        state.room = data.room;
        updateSidebar();
      }
    });

    state.socket.on('player-finished', (data) => {
      UI.toast(`🏆 ${data.playerName} finished! (${data.clicks} clicks)`, 'success');
      updateSidebar();
    });

    state.socket.on('player-gave-up', (data) => {
      if (state.room) {
        state.room = data.room;
        updateSidebar();
      }
    });

    state.socket.on('game-over', (results) => {
      showResults(results);
    });

    state.socket.on('back-to-lobby', (roomInfo) => {
      state.room = roomInfo;
      state.gameActive = false;
      clearInterval(state.timerInterval);
      state.isHost = roomInfo.hostId === state.socket.id;
      UI.showScreen('screen-lobby');
      renderLobby();
    });
  }

  // ---- Event Bindings ----
  function bindEvents() {
    // Home screen
    document.getElementById('btn-solo').addEventListener('click', () => {
      if (!validateName()) return;
      state.mode = 'solo';
      UI.showScreen('screen-solo-setup');
    });

    document.getElementById('btn-create-room').addEventListener('click', () => {
      if (!validateName()) return;
      UI.showModal('modal-create');
    });

    document.getElementById('btn-join-room').addEventListener('click', () => {
      if (!validateName()) return;
      UI.showModal('modal-join');
    });

    // Join modal
    document.getElementById('btn-close-join').addEventListener('click', () => UI.hideModal('modal-join'));
    document.getElementById('btn-submit-join').addEventListener('click', joinRoom);
    document.getElementById('join-code').addEventListener('keyup', (e) => {
      if (e.key === 'Enter') joinRoom();
    });

    // Create modal
    document.getElementById('btn-close-create').addEventListener('click', () => UI.hideModal('modal-create'));
    document.getElementById('btn-submit-create').addEventListener('click', createRoom);

    // Mode toggles in create modal
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const teams = btn.dataset.mode === 'teams';
        document.getElementById('team-options').classList.toggle('hidden', !teams);
      });
    });

    document.querySelectorAll('[data-teams]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-teams]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Lobby
    document.getElementById('btn-leave-room').addEventListener('click', leaveRoom);
    document.getElementById('btn-copy-code').addEventListener('click', copyRoomCode);
    document.getElementById('btn-start-game').addEventListener('click', hostStartGame);

    // Article source radio buttons (lobby)
    document.querySelectorAll('input[name="article-source"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const custom = document.getElementById('custom-articles');
        custom.classList.toggle('hidden', radio.value !== 'custom');
      });
    });

    // Custom article search (lobby)
    setupSearch('custom-start', 'start-results', (title) => {
      document.getElementById('custom-start').value = title;
      state.customStart = title;
    });
    setupSearch('custom-target', 'target-results', (title) => {
      document.getElementById('custom-target').value = title;
      state.customTarget = title;
    });

    // Solo setup
    document.getElementById('btn-back-solo').addEventListener('click', () => UI.showScreen('screen-home'));
    document.getElementById('btn-start-solo').addEventListener('click', startSoloGame);

    document.querySelectorAll('input[name="solo-source"]').forEach(radio => {
      radio.addEventListener('change', () => {
        const custom = document.getElementById('solo-custom-articles');
        custom.classList.toggle('hidden', radio.value !== 'custom');
      });
    });

    setupSearch('solo-custom-start', 'solo-start-results', (title) => {
      document.getElementById('solo-custom-start').value = title;
      state.soloCustomStart = title;
    });
    setupSearch('solo-custom-target', 'solo-target-results', (title) => {
      document.getElementById('solo-custom-target').value = title;
      state.soloCustomTarget = title;
    });

    // Game screen
    document.getElementById('btn-give-up').addEventListener('click', giveUp);
    document.getElementById('btn-end-round').addEventListener('click', hostEndRound);

    // Results
    document.getElementById('btn-play-again').addEventListener('click', playAgain);
    document.getElementById('btn-back-home').addEventListener('click', backToHome);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    });

    // Lobby settings
    document.getElementById('setting-time-limit')?.addEventListener('change', (e) => {
      if (!state.isHost) return;
      state.socket.emit('update-settings', {
        settings: { timeLimit: parseInt(e.target.value) }
      }, () => {});
    });

    // Close search results on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-field')) {
        document.querySelectorAll('.search-results').forEach(sr => sr.classList.remove('open'));
      }
    });
  }

  // ---- Validation ----
  function validateName() {
    const input = document.getElementById('player-name');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      input.style.borderColor = 'var(--danger)';
      setTimeout(() => { input.style.borderColor = ''; }, 2000);
      UI.toast('Please enter your name!', 'error');
      return false;
    }
    state.playerName = name;
    localStorage.setItem('wikirace-name', name);
    return true;
  }

  // ---- Room Actions ----
  function createRoom() {
    const mode = document.querySelector('[data-mode].active')?.dataset.mode || 'ffa';
    const teamCount = parseInt(document.querySelector('[data-teams].active')?.dataset.teams || '2');
    const autoTeams = document.getElementById('auto-teams')?.checked !== false;

    const btn = document.getElementById('btn-submit-create');
    UI.setLoading(btn, true);

    state.socket.emit('create-room', {
      playerName: state.playerName,
      mode,
      teamCount,
      autoTeams,
    }, (response) => {
      UI.setLoading(btn, false);
      if (response.success) {
        state.room = response.room;
        state.isHost = true;
        state.mode = 'multi';
        UI.hideModal('modal-create');
        UI.showScreen('screen-lobby');
        renderLobby();
      } else {
        UI.toast(response.error || 'Failed to create room', 'error');
      }
    });
  }

  function joinRoom() {
    const code = document.getElementById('join-code').value.toUpperCase().trim();
    if (code.length !== 4) {
      document.getElementById('join-error').textContent = 'Enter a 4-character code';
      return;
    }

    const btn = document.getElementById('btn-submit-join');
    UI.setLoading(btn, true);

    state.socket.emit('join-room', { code, playerName: state.playerName }, (response) => {
      UI.setLoading(btn, false);
      if (response.success) {
        state.room = response.room;
        state.isHost = false;
        state.mode = 'multi';
        document.getElementById('join-error').textContent = '';
        UI.hideModal('modal-join');
        UI.showScreen('screen-lobby');
        renderLobby();
      } else {
        document.getElementById('join-error').textContent = response.error || 'Failed to join room';
      }
    });
  }

  function leaveRoom() {
    state.socket.emit('leave-room', () => {
      state.room = null;
      state.gameActive = false;
      clearInterval(state.timerInterval);
      UI.showScreen('screen-home');
    });
  }

  function copyRoomCode() {
    if (state.room) {
      navigator.clipboard.writeText(state.room.code).then(() => {
        UI.toast('Room code copied!', 'success');
      }).catch(() => {
        UI.toast('Copy failed — code: ' + state.room.code, 'info');
      });
    }
  }

  // ---- Lobby Rendering ----
  function renderLobby() {
    if (!state.room) return;

    document.getElementById('lobby-room-code').textContent = state.room.code;
    document.getElementById('lobby-player-count').textContent = `(${state.room.players.length})`;

    // Player list
    const playerList = document.getElementById('lobby-players');
    playerList.innerHTML = '';
    state.room.players.forEach(p => {
      const card = UI.createPlayerCard(p, p.id === state.room.hostId, p.id === state.socket.id);
      playerList.appendChild(card);
    });

    // Show/hide host controls
    const hostControls = document.getElementById('lobby-host-controls');
    const guestMsg = document.getElementById('lobby-guest-msg');

    if (state.isHost) {
      hostControls.classList.remove('hidden');
      guestMsg.classList.add('hidden');

      // Update settings inputs to match room
      const timeLimitEl = document.getElementById('setting-time-limit');
      if (timeLimitEl) timeLimitEl.value = state.room.settings.timeLimit || 0;
    } else {
      hostControls.classList.add('hidden');
      guestMsg.classList.remove('hidden');
      
      // Update guest message to show current settings?
      const timeLimit = state.room.settings.timeLimit ? `${state.room.settings.timeLimit} min` : 'No Limit';
      guestMsg.querySelector('p').innerHTML = `⏳ Waiting for host... <br><small>Mode: ${state.room.settings.mode.toUpperCase()} • Time: ${timeLimit}</small>`;
    }

    // Team picker
    const teamPicker = document.getElementById('team-picker');
    if (state.room.settings.mode === 'teams' && !state.room.settings.autoTeams) {
      teamPicker.classList.remove('hidden');
      renderTeamPicker();
    } else {
      teamPicker.classList.add('hidden');
    }
  }

  function renderTeamPicker() {
    const container = document.getElementById('team-buttons');
    container.innerHTML = '';
    const teamColors = ['var(--team-0)', 'var(--team-1)', 'var(--team-2)', 'var(--team-3)'];
    const teamNames = ['Team 1', 'Team 2', 'Team 3', 'Team 4'];

    const myPlayer = state.room?.players.find(p => p.id === state.socket.id);
    const myTeam = myPlayer?.team;

    for (let i = 0; i < (state.room?.settings.teamCount || 2); i++) {
      const btn = document.createElement('button');
      btn.className = 'team-btn' + (myTeam === i ? ' active' : '');
      btn.textContent = teamNames[i];
      btn.style.borderColor = teamColors[i];
      if (myTeam === i) {
        btn.style.background = teamColors[i];
      }
      btn.addEventListener('click', () => {
        state.socket.emit('set-team', { team: i }, () => {});
      });
      container.appendChild(btn);
    }
  }

  // ---- Search Setup ----
  function setupSearch(inputId, resultsId, onSelect) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', () => {
      clearTimeout(state.searchDebounce);
      const query = input.value.trim();
      if (query.length < 2) {
        UI.hideSearchResults(resultsId);
        return;
      }

      state.searchDebounce = setTimeout(async () => {
        try {
          const res = await fetch(`/api/wiki/search?q=${encodeURIComponent(query)}`);
          const results = await res.json();
          UI.showSearchResults(resultsId, results, (title) => {
            onSelect(title);
          });
        } catch (err) {
          console.error('Search error:', err);
        }
      }, 300);
    });

    input.addEventListener('focus', () => {
      const query = input.value.trim();
      if (query.length >= 2) {
        // Re-trigger search on focus
        input.dispatchEvent(new Event('input'));
      }
    });
  }

  // ---- Game Start ----
  function hostStartGame() {
    const btn = document.getElementById('btn-start-game');
    UI.setLoading(btn, true);

    const isCustom = document.querySelector('input[name="article-source"]:checked')?.value === 'custom';

    state.socket.emit('start-game', {
      customStart: isCustom ? state.customStart : null,
      customTarget: isCustom ? state.customTarget : null,
    }, (response) => {
      UI.setLoading(btn, false);
      if (!response.success) {
        UI.toast(response.error || 'Failed to start game', 'error');
      }
    });
  }

  async function startSoloGame() {
    const btn = document.getElementById('btn-start-solo');
    UI.setLoading(btn, true);

    const isCustom = document.querySelector('input[name="solo-source"]:checked')?.value === 'custom';

    state.socket.emit('solo-start', {
      customStart: isCustom ? state.soloCustomStart : null,
      customTarget: isCustom ? state.soloCustomTarget : null,
    }, async (response) => {
      UI.setLoading(btn, false);

      if (!response.success) {
        UI.toast(response.error || 'Failed to start game', 'error');
        return;
      }

      state.mode = 'solo';
      state.targetTitle = response.targetArticle.title;

      UI.showScreen('screen-game');
      await UI.showCountdown(response.startArticle.title, response.targetArticle.title);

      startGame({
        startHtml: response.startArticle.html,
        startTitle: response.startArticle.title,
        startDisplayTitle: response.startArticle.displayTitle,
        targetTitle: response.targetArticle.title,
        targetDisplayTitle: response.targetArticle.displayTitle,
      }, 'solo');
    });
  }

  function startGame(data, mode) {
    state.mode = mode;
    state.gameActive = true;
    state.clicks = 0;
    state.path = [data.startTitle];
    state.startTime = Date.now();
    state.targetTitle = data.targetTitle;
    state.currentArticle = data.startTitle;

    // Update header
    document.getElementById('game-clicks').textContent = '0';
    document.getElementById('game-time').textContent = '0:00';
    document.getElementById('game-target-title').textContent = (data.targetDisplayTitle || data.targetTitle).replace(/_/g, ' ');

    // Show/hide sidebar
    // Show/hide host-only controls
    const endRoundBtn = document.getElementById('btn-end-round');
    if (state.isHost) {
      endRoundBtn.classList.remove('hidden');
    } else {
      endRoundBtn.classList.add('hidden');
    }

    const sidebar = document.getElementById('players-sidebar');
    if (mode === 'multi') {
      sidebar.classList.remove('hidden');
      updateSidebar();
    } else {
      sidebar.classList.add('hidden');
    }

    // Render article
    renderArticle(data.startTitle, data.startDisplayTitle, data.startHtml);

    // Start timer
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(updateTimer, 1000);

    if (data.timeLimit > 0) {
      state.timeRemaining = data.timeLimit * 60;
      updateTimer(); // Initial render
    }

    UI.updateBreadcrumb(state.path);
  }

  // ---- Article Rendering ----
  function renderArticle(title, displayTitle, html) {
    const titleEl = document.getElementById('article-title');
    const contentEl = document.getElementById('article-content');

    titleEl.innerHTML = (displayTitle || title).replace(/_/g, ' ');
    contentEl.innerHTML = html;
    contentEl.scrollTop = 0;

    // Bind wiki link clicks
    contentEl.querySelectorAll('.wiki-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (!state.gameActive) return;
        const linkTitle = link.dataset.title;
        if (linkTitle) navigateToArticle(linkTitle);
      });
    });
  }

  async function navigateToArticle(title) {
    const contentEl = document.getElementById('article-content');
    contentEl.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading article...</p>
      </div>
    `;

    const eventName = state.mode === 'solo' ? 'solo-navigate' : 'navigate';

    state.socket.emit(eventName, { title }, (response) => {
      if (!response.success) {
        UI.toast(response.error || 'Failed to load article', 'error');
        return;
      }

      const article = response.article;
      state.currentArticle = article.title;

      if (state.mode === 'solo') {
        state.clicks++;
        state.path.push(article.title);
      } else {
        state.clicks = response.clicks || state.clicks + 1;
        state.path.push(article.title);
      }

      document.getElementById('game-clicks').textContent = state.clicks;
      UI.updateBreadcrumb(state.path);

      renderArticle(article.title, article.displayTitle, article.html);

      // Check win (solo)
      if (state.mode === 'solo') {
        const normalizedTarget = state.targetTitle.replace(/_/g, ' ').toLowerCase();
        const normalizedCurrent = article.title.replace(/_/g, ' ').toLowerCase();

        if (normalizedCurrent === normalizedTarget) {
          handleWin();
        }
      } else if (response.won) {
        handleWin();
      }
    });
  }

  function handleWin() {
    state.gameActive = false;
    clearInterval(state.timerInterval);
    const elapsed = Date.now() - state.startTime;

    UI.showWin(state.clicks, elapsed);

    if (state.mode === 'solo') {
      setTimeout(() => {
        showResults({
          startArticle: state.path[0],
          targetArticle: state.targetTitle,
          players: [{
            name: state.playerName,
            clicks: state.clicks,
            time: elapsed,
            finished: true,
            path: state.path,
            team: null,
          }],
          teamResults: null,
          mode: 'ffa',
          isSolo: true,
        });
      }, 3200);
    }
  }

  // ---- Timer ----
  function updateTimer() {
    if (!state.startTime || !state.gameActive) return;
    
    const timeEl = document.getElementById('game-time');
    const elapsed = Date.now() - state.startTime;

    if (state.timeRemaining > 0) {
      const remainingTotal = (state.timeRemaining * 1000) - elapsed;
      if (remainingTotal <= 0) {
        timeEl.textContent = '0:00';
        timeEl.classList.add('danger');
        return;
      }
      timeEl.textContent = UI.formatTime(remainingTotal);
      if (remainingTotal < 30000) {
        timeEl.classList.add('danger');
      } else {
        timeEl.classList.remove('danger');
      }
    } else {
      timeEl.textContent = UI.formatTime(elapsed);
    }
  }

  function hostEndRound() {
    if (!state.isHost) return;
    if (confirm('Are you sure you want to end this round for everyone?')) {
      state.socket.emit('end-game', () => {});
    }
  }

  // ---- Sidebar ----
  function updateSidebar() {
    if (!state.room) return;
    const container = document.getElementById('sidebar-players');
    container.innerHTML = '';

    state.room.players.forEach(p => {
      const el = UI.createSidebarPlayer(p, p.id === state.socket.id);
      container.appendChild(el);
    });
  }

  // ---- Give Up ----
  function giveUp() {
    if (!state.gameActive) return;
    state.gameActive = false;
    clearInterval(state.timerInterval);

    if (state.mode === 'solo') {
      showResults({
        startArticle: state.path[0],
        targetArticle: state.targetTitle,
        players: [{
          name: state.playerName,
          clicks: state.clicks,
          time: null,
          finished: false,
          path: state.path,
          team: null,
        }],
        teamResults: null,
        mode: 'ffa',
        isSolo: true,
      });
    } else {
      state.socket.emit('give-up', () => {});
    }
  }

  // ---- Results ----
  function showResults(results) {
    state.gameActive = false;
    clearInterval(state.timerInterval);

    UI.showScreen('screen-results');

    document.getElementById('results-start').textContent = (results.startArticle || '').replace(/_/g, ' ');
    document.getElementById('results-target').textContent = (results.targetArticle || '').replace(/_/g, ' ');

    const soloSection = document.getElementById('solo-results');
    const multiSection = document.getElementById('multi-results');

    if (results.isSolo) {
      soloSection.classList.remove('hidden');
      multiSection.classList.add('hidden');

      const player = results.players[0];
      document.getElementById('result-clicks').textContent = player.clicks;
      document.getElementById('result-time').textContent = player.time ? UI.formatTime(player.time) : 'Gave Up';
      document.getElementById('results-title').textContent = player.finished ? '🏆 Race Complete!' : '😢 Gave Up';

      UI.createPathDisplay(player.path);
    } else {
      soloSection.classList.add('hidden');
      multiSection.classList.remove('hidden');

      // Player results
      const playerContainer = document.getElementById('player-results');
      playerContainer.innerHTML = '';
      results.players.forEach((p, i) => {
        playerContainer.appendChild(UI.createResultRow(p, i + 1));
      });

      // Team results
      const teamSection = document.getElementById('team-results-section');
      if (results.teamResults && results.teamResults.length > 0) {
        teamSection.classList.remove('hidden');
        const teamContainer = document.getElementById('team-results');
        teamContainer.innerHTML = '';
        const teamNames = ['Team 1', 'Team 2', 'Team 3', 'Team 4'];
        results.teamResults.forEach((t, i) => {
          const card = document.createElement('div');
          card.className = 'team-result-card';
          card.style.borderColor = `var(--team-${t.team})`;
          card.innerHTML = `
            <div class="team-result-header">
              <span class="team-result-name" style="color:var(--team-${t.team})">${i === 0 ? '🏆 ' : ''}${teamNames[t.team]}</span>
              <span class="team-result-stats">${t.finishedCount}/${t.players.length} finished</span>
            </div>
            <div class="team-result-stats">
              Avg clicks: ${t.avgClicks === Infinity ? '—' : t.avgClicks.toFixed(1)}  •  
              Avg time: ${t.avgTime === Infinity ? '—' : UI.formatTime(t.avgTime)}
            </div>
          `;
          teamContainer.appendChild(card);
        });
      } else {
        teamSection.classList.add('hidden');
      }

      // Set title based on if current player won
      const myResult = results.players.find(p => p.name === state.playerName);
      if (myResult && myResult.finished && results.players.indexOf(myResult) === 0) {
        document.getElementById('results-title').textContent = '🏆 You Won!';
      } else if (myResult && myResult.finished) {
        document.getElementById('results-title').textContent = '🎉 Race Complete!';
      } else {
        document.getElementById('results-title').textContent = '🏁 Race Over';
      }
    }

    // Show/hide play again based on role
    const playAgainBtn = document.getElementById('btn-play-again');
    if (state.mode === 'solo' || state.isHost) {
      playAgainBtn.classList.remove('hidden');
    } else {
      playAgainBtn.classList.add('hidden');
    }
  }

  function playAgain() {
    if (state.mode === 'solo') {
      UI.showScreen('screen-solo-setup');
    } else {
      state.socket.emit('play-again', (response) => {
        if (!response.success) {
          UI.toast('Failed to restart', 'error');
        }
      });
    }
  }

  function backToHome() {
    if (state.mode === 'multi') {
      state.socket.emit('leave-room', () => {});
    }
    state.room = null;
    state.gameActive = false;
    clearInterval(state.timerInterval);
    UI.showScreen('screen-home');
  }

  // ---- Start ----
  document.addEventListener('DOMContentLoaded', init);
})();
