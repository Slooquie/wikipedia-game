// game-manager.js — Room lifecycle, game state, team scoring

class GameManager {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map(); // socketId -> roomCode

    // Clean up idle rooms every 5 minutes
    setInterval(() => this.cleanupIdleRooms(), 5 * 60 * 1000);
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostId, hostName, settings = {}) {
    const code = this.generateCode();
    const room = {
      code,
      hostId,
      state: 'lobby', // lobby | countdown | playing | finished
      createdAt: Date.now(),
      lastActivity: Date.now(),
      settings: {
        mode: settings.mode || 'ffa', // ffa | teams
        teamCount: settings.teamCount || 2,
        autoTeams: settings.autoTeams !== false,
        customStart: settings.customStart || null,
        customTarget: settings.customTarget || null,
        timeLimit: settings.timeLimit || 0, // 0 = no limit
      },
      players: new Map(),
      teams: new Map(),
      startArticle: null,
      targetArticle: null,
      startTime: null,
      gameHistory: [],
    };

    room.players.set(hostId, {
      id: hostId,
      name: hostName,
      team: null,
      currentArticle: null,
      clicks: 0,
      path: [],
      startTime: null,
      finishTime: null,
      finished: false,
      connected: true,
    });

    this.rooms.set(code, room);
    this.playerRooms.set(hostId, code);
    return room;
  }

  joinRoom(code, playerId, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.state !== 'lobby') return { error: 'Game already in progress' };
    if (room.players.size >= 20) return { error: 'Room is full (max 20)' };

    room.players.set(playerId, {
      id: playerId,
      name: playerName,
      team: null,
      currentArticle: null,
      clicks: 0,
      path: [],
      startTime: null,
      finishTime: null,
      finished: false,
      connected: true,
    });

    room.lastActivity = Date.now();
    this.playerRooms.set(playerId, code);

    // Auto-assign team if in teams mode
    if (room.settings.mode === 'teams' && room.settings.autoTeams) {
      this.autoAssignTeam(room, playerId);
    }

    return { room };
  }

  leaveRoom(playerId) {
    const code = this.playerRooms.get(playerId);
    if (!code) return null;

    const room = this.rooms.get(code);
    if (!room) {
      this.playerRooms.delete(playerId);
      return null;
    }

    room.players.delete(playerId);
    this.playerRooms.delete(playerId);
    room.lastActivity = Date.now();

    // If host left, assign new host or destroy room
    if (room.hostId === playerId) {
      if (room.players.size > 0) {
        room.hostId = room.players.keys().next().value;
      } else {
        this.rooms.delete(code);
        return { destroyed: true, code };
      }
    }

    return { room, newHost: room.hostId };
  }

  disconnectPlayer(playerId) {
    const code = this.playerRooms.get(playerId);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) return null;

    const player = room.players.get(playerId);
    if (player) {
      player.connected = false;
    }

    // If in lobby, treat as leave
    if (room.state === 'lobby') {
      return this.leaveRoom(playerId);
    }

    return { room };
  }

  reconnectPlayer(playerId, code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player) return null;
    player.connected = true;
    this.playerRooms.set(playerId, code);
    return { room };
  }

  setTeam(code, playerId, teamIndex) {
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players.get(playerId);
    if (!player) return null;
    player.team = teamIndex;
    room.lastActivity = Date.now();
    return { room };
  }

  autoAssignTeam(room, playerId) {
    const teamCounts = new Array(room.settings.teamCount).fill(0);
    for (const [, p] of room.players) {
      if (p.id !== playerId && p.team !== null) {
        teamCounts[p.team]++;
      }
    }
    const minTeam = teamCounts.indexOf(Math.min(...teamCounts));
    const player = room.players.get(playerId);
    if (player) player.team = minTeam;
  }

  autoAssignAllTeams(room) {
    const playerIds = [...room.players.keys()];
    // Shuffle
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }
    playerIds.forEach((id, idx) => {
      const player = room.players.get(id);
      if (player) player.team = idx % room.settings.teamCount;
    });
  }

  startGame(code, startArticle, targetArticle) {
    const room = this.rooms.get(code);
    if (!room) return null;

    room.startArticle = startArticle;
    room.targetArticle = targetArticle;
    room.state = 'countdown';
    room.lastActivity = Date.now();

    // If teams mode and auto-assign, shuffle teams now
    if (room.settings.mode === 'teams' && room.settings.autoTeams) {
      this.autoAssignAllTeams(room);
    }

    // Initialize all players
    for (const [, player] of room.players) {
      player.currentArticle = startArticle;
      player.clicks = 0;
      player.path = [startArticle];
      player.startTime = null;
      player.finishTime = null;
      player.finished = false;
    }

    return { room };
  }

  beginPlay(code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.state = 'playing';
    room.startTime = Date.now();
    for (const [, player] of room.players) {
      player.startTime = Date.now();
    }
    return { room };
  }

  playerNavigate(playerId, articleTitle) {
    const code = this.playerRooms.get(playerId);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room || room.state !== 'playing') return null;

    const player = room.players.get(playerId);
    if (!player || player.finished) return null;

    player.currentArticle = articleTitle;
    player.clicks++;
    player.path.push(articleTitle);
    room.lastActivity = Date.now();

    // Check win
    const normalizedTarget = room.targetArticle.replace(/_/g, ' ').toLowerCase();
    const normalizedCurrent = articleTitle.replace(/_/g, ' ').toLowerCase();

    if (normalizedCurrent === normalizedTarget) {
      player.finished = true;
      player.finishTime = Date.now();

      // Check if all players finished
      const allFinished = [...room.players.values()].every(p => p.finished || !p.connected);
      if (allFinished) {
        room.state = 'finished';
      }

      return { room, player, won: true, allFinished: room.state === 'finished' };
    }

    return { room, player, won: false };
  }

  endGame(code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.state = 'finished';
    room.lastActivity = Date.now();
    return this.getResults(code);
  }

  getResults(code) {
    const room = this.rooms.get(code);
    if (!room) return null;

    const players = [...room.players.values()].map(p => ({
      name: p.name,
      team: p.team,
      clicks: p.clicks,
      time: p.finishTime ? p.finishTime - p.startTime : null,
      finished: p.finished,
      path: p.path,
    }));

    // Sort: finished first (by clicks, then time), unfinished last
    players.sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) {
        if (a.clicks !== b.clicks) return a.clicks - b.clicks;
        return (a.time || Infinity) - (b.time || Infinity);
      }
      return 0;
    });

    // Team scores
    let teamResults = null;
    if (room.settings.mode === 'teams') {
      const teams = {};
      for (const p of players) {
        if (p.team === null) continue;
        if (!teams[p.team]) teams[p.team] = { team: p.team, players: [], avgClicks: 0, avgTime: 0, finishedCount: 0 };
        teams[p.team].players.push(p);
        if (p.finished) {
          teams[p.team].finishedCount++;
        }
      }
      for (const t of Object.values(teams)) {
        const finished = t.players.filter(p => p.finished);
        t.avgClicks = finished.length ? finished.reduce((s, p) => s + p.clicks, 0) / finished.length : Infinity;
        t.avgTime = finished.length ? finished.reduce((s, p) => s + p.time, 0) / finished.length : Infinity;
      }
      teamResults = Object.values(teams).sort((a, b) => {
        if (a.finishedCount !== b.finishedCount) return b.finishedCount - a.finishedCount;
        if (a.avgClicks !== b.avgClicks) return a.avgClicks - b.avgClicks;
        return a.avgTime - b.avgTime;
      });
    }

    return {
      startArticle: room.startArticle,
      targetArticle: room.targetArticle,
      players,
      teamResults,
      mode: room.settings.mode,
    };
  }

  resetRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.state = 'lobby';
    room.startArticle = null;
    room.targetArticle = null;
    room.startTime = null;
    for (const [, player] of room.players) {
      player.currentArticle = null;
      player.clicks = 0;
      player.path = [];
      player.startTime = null;
      player.finishTime = null;
      player.finished = false;
    }
    room.lastActivity = Date.now();
    return { room };
  }

  getRoomInfo(code) {
    const room = this.rooms.get(code);
    if (!room) return null;
    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      startArticle: room.startArticle,
      targetArticle: room.targetArticle,
      players: [...room.players.values()].map(p => ({
        id: p.id,
        name: p.name,
        team: p.team,
        currentArticle: p.currentArticle,
        clicks: p.clicks,
        finished: p.finished,
        connected: p.connected,
        time: p.finishTime && p.startTime ? p.finishTime - p.startTime : null,
      })),
    };
  }

  getPlayerRoom(playerId) {
    const code = this.playerRooms.get(playerId);
    return code ? this.rooms.get(code) : null;
  }

  cleanupIdleRooms() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > timeout) {
        // Clean up player mappings
        for (const [playerId] of room.players) {
          this.playerRooms.delete(playerId);
        }
        this.rooms.delete(code);
        console.log(`[Cleanup] Removed idle room ${code}`);
      }
    }
  }

  updateSettings(code, settings) {
    const room = this.rooms.get(code);
    if (!room) return null;
    Object.assign(room.settings, settings);
    room.lastActivity = Date.now();
    return { room };
  }
}

module.exports = GameManager;
