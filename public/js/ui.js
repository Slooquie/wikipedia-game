// ui.js — DOM helpers, toasts, transitions, confetti

const UI = {
  // ---- Screen Management ----
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.add('active');
      screen.style.animation = 'none';
      screen.offsetHeight; // Trigger reflow
      screen.style.animation = '';
    }
  },

  // ---- Modals ----
  showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  },

  hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  },

  // ---- Toasts ----
  toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ---- Player Cards ----
  createPlayerCard(player, isHost, isMe) {
    const card = document.createElement('div');
    card.className = 'player-card' + (isHost ? ' is-host' : '');

    const avatarColors = [
      '#6366f1', '#ec4899', '#10b981', '#f59e0b',
      '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16',
    ];
    const colorIdx = Math.abs(player.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % avatarColors.length;

    card.innerHTML = `
      <div class="player-avatar" style="background:${avatarColors[colorIdx]}">
        ${player.name.charAt(0).toUpperCase()}
      </div>
      <span class="player-name">${this.escapeHtml(player.name)}${isMe ? ' (You)' : ''}</span>
      ${isHost ? '<span class="player-badge">Host</span>' : ''}
      ${player.team !== null && player.team !== undefined ? `<span class="team-badge" style="background:var(--team-${player.team})">Team ${player.team + 1}</span>` : ''}
    `;

    return card;
  },

  // ---- Sidebar Player ----
  createSidebarPlayer(player, isMe) {
    const div = document.createElement('div');
    div.className = 'sidebar-player' + (player.finished ? ' finished' : '');
    div.id = `sidebar-player-${player.id}`;

    const statusText = player.finished
      ? `✅ Finished! (${player.clicks} clicks${player.time ? ', ' + this.formatTime(player.time) : ''})`
      : `📄 ${player.currentArticle || 'Waiting...'}`;

    div.innerHTML = `
      <div class="sidebar-player-name">
        ${player.team !== null && player.team !== undefined ? `<span style="color:var(--team-${player.team})">●</span>` : ''}
        ${this.escapeHtml(player.name)}${isMe ? ' (You)' : ''}
      </div>
      <div class="sidebar-player-clicks">${player.clicks} click${player.clicks !== 1 ? 's' : ''}</div>
      <div class="sidebar-player-status">${statusText}</div>
    `;

    return div;
  },

  // ---- Results: Player Row ----
  createResultRow(player, rank) {
    const row = document.createElement('div');
    row.className = 'result-row';

    const medals = ['🥇', '🥈', '🥉'];
    const rankDisplay = rank <= 3 ? medals[rank - 1] : `#${rank}`;

    if (!player.finished) {
      row.innerHTML = `
        <div class="result-rank">${rankDisplay}</div>
        <div class="result-info">
          <div class="result-name">${this.escapeHtml(player.name)}</div>
          <div class="result-detail result-gave-up">Gave up (${player.clicks} clicks)</div>
        </div>
      `;
    } else {
      row.innerHTML = `
        <div class="result-rank">${rankDisplay}</div>
        <div class="result-info">
          <div class="result-name">${this.escapeHtml(player.name)}</div>
          ${player.team !== null && player.team !== undefined ? `<div class="result-detail" style="color:var(--team-${player.team})">Team ${player.team + 1}</div>` : ''}
        </div>
        <div class="result-stats">
          <span>${player.clicks} click${player.clicks !== 1 ? 's' : ''}</span>
          <span>${player.time ? this.formatTime(player.time) : '—'}</span>
        </div>
      `;
    }

    return row;
  },

  // ---- Breadcrumb ----
  updateBreadcrumb(path) {
    const container = document.getElementById('game-path');
    container.innerHTML = '';
    const maxShow = 8;
    const showPath = path.length > maxShow
      ? [path[0], '...', ...path.slice(-maxShow + 2)]
      : path;

    showPath.forEach((item, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '›';
        container.appendChild(sep);
      }
      const crumb = document.createElement('span');
      crumb.className = 'breadcrumb-item';
      crumb.textContent = typeof item === 'string' ? item.replace(/_/g, ' ') : item;
      container.appendChild(crumb);
    });

    // Auto-scroll to end
    const bc = document.querySelector('.game-breadcrumb');
    if (bc) bc.scrollLeft = bc.scrollWidth;
  },

  // ---- Path Display (Results) ----
  createPathDisplay(path) {
    const container = document.getElementById('result-path-display');
    container.innerHTML = '';
    path.forEach((item, i) => {
      if (i > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'path-arrow';
        arrow.textContent = '→';
        container.appendChild(arrow);
      }
      const pill = document.createElement('span');
      pill.className = 'path-item';
      pill.textContent = item.replace(/_/g, ' ');
      container.appendChild(pill);
    });
  },

  // ---- Countdown ----
  async showCountdown(startTitle, targetTitle) {
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    document.getElementById('countdown-start').textContent = startTitle.replace(/_/g, ' ');
    document.getElementById('countdown-target').textContent = targetTitle.replace(/_/g, ' ');

    overlay.classList.remove('hidden');

    for (let i = 3; i >= 1; i--) {
      numEl.textContent = i;
      numEl.style.animation = 'none';
      numEl.offsetHeight;
      numEl.style.animation = 'countdownPop 0.5s ease';
      await this.sleep(1000);
    }

    numEl.textContent = 'GO!';
    numEl.style.animation = 'none';
    numEl.offsetHeight;
    numEl.style.animation = 'countdownPop 0.5s ease';
    await this.sleep(500);

    overlay.classList.add('hidden');
  },

  // ---- Win Overlay ----
  showWin(clicks, time) {
    const overlay = document.getElementById('win-overlay');
    const stats = document.getElementById('win-stats');
    stats.textContent = `${clicks} click${clicks !== 1 ? 's' : ''} • ${this.formatTime(time)}`;
    overlay.classList.remove('hidden');

    this.spawnConfetti();

    setTimeout(() => {
      overlay.classList.add('hidden');
    }, 3000);
  },

  // ---- Confetti ----
  spawnConfetti() {
    const colors = ['#6366f1', '#c084fc', '#34d399', '#fbbf24', '#f43f5e', '#06b6d4'];
    const shapes = ['circle', 'square'];

    for (let i = 0; i < 60; i++) {
      const particle = document.createElement('div');
      particle.className = 'confetti-particle';
      const color = colors[Math.floor(Math.random() * colors.length)];
      const shape = shapes[Math.floor(Math.random() * shapes.length)];
      particle.style.background = color;
      particle.style.left = Math.random() * 100 + 'vw';
      particle.style.top = '-10px';
      particle.style.animationDuration = (2 + Math.random() * 2) + 's';
      particle.style.animationDelay = Math.random() * 0.5 + 's';
      if (shape === 'circle') particle.style.borderRadius = '50%';
      else particle.style.borderRadius = '2px';
      particle.style.width = (6 + Math.random() * 8) + 'px';
      particle.style.height = (6 + Math.random() * 8) + 'px';

      document.body.appendChild(particle);
      setTimeout(() => particle.remove(), 4000);
    }
  },

  // ---- Search Results ----
  showSearchResults(containerId, results, onSelect) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    if (results.length === 0) {
      container.classList.remove('open');
      return;
    }

    results.forEach(title => {
      const div = document.createElement('div');
      div.className = 'search-result-item';
      div.textContent = title;
      div.addEventListener('click', () => {
        onSelect(title);
        container.classList.remove('open');
      });
      container.appendChild(div);
    });
    container.classList.add('open');
  },

  hideSearchResults(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.classList.remove('open');
  },

  // ---- Helpers ----
  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // ---- Loading States ----
  setLoading(btnEl, loading, originalText) {
    if (loading) {
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>';
      btnEl.disabled = true;
    } else {
      btnEl.innerHTML = btnEl.dataset.originalText || originalText || 'Button';
      btnEl.disabled = false;
    }
  },
};
