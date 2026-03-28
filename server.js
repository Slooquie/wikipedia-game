// server.js — Express + Socket.IO + Wikipedia proxy
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameManager = require('./game-manager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const gm = new GameManager();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Wikipedia Proxy API ----------

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'WikipediaRaceGame/1.0 (https://github.com/wiki-race; contact@wikirace.game)';

async function fetchArticle(title) {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'text|displaytitle|links',
    format: 'json',
    disableeditsection: '1',
    redirects: '1',
  });

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();

  if (data.error) throw new Error(data.error.info || 'Article not found');

  const parsed = data.parse;
  let html = parsed.text['*'];

  // Extract internal links (namespace 0 = main articles)
  const links = (parsed.links || [])
    .filter(l => l.ns === 0 && l.exists !== undefined)
    .map(l => l['*']);

  // Sanitize HTML for game use
  html = sanitizeWikiHtml(html);

  // Strip HTML from display title
  const cleanDisplayTitle = (parsed.displaytitle || parsed.title || '')
    .replace(/<[^>]*>/g, '');

  return {
    title: parsed.title,
    displayTitle: cleanDisplayTitle,
    html,
    links,
  };
}

function sanitizeWikiHtml(html) {
  // Remove edit sections
  html = html.replace(/<span class="mw-editsection">[\s\S]*?<\/span><\/span>/gi, '');

  // Remove references section and everything after
  // Keep the content but remove [1] [2] style reference numbers
  html = html.replace(/<sup[^>]*class="reference"[^>]*>[\s\S]*?<\/sup>/gi, '');

  // Remove navboxes, metadata, and other non-content elements
  html = html.replace(/<div[^>]*class="[^"]*navbox[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '');
  html = html.replace(/<div[^>]*class="[^"]*metadata[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  html = html.replace(/<table[^>]*class="[^"]*navbox[^"]*"[^>]*>[\s\S]*?<\/table>/gi, '');
  html = html.replace(/<div[^>]*class="[^"]*mw-empty-elt[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // Remove "stub" notices
  html = html.replace(/<div[^>]*class="[^"]*stub[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // Remove authority control
  html = html.replace(/<div[^>]*class="[^"]*authority-control[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

  // Step 1: Rewrite internal wiki links (handles href anywhere in the tag)
  // This regex matches <a> tags that contain href="/wiki/..." anywhere in their attributes
  html = html.replace(
    /<a\b([^>]*?)href="\/wiki\/([^"#]+)(#[^"]*)?"([^>]*)>([\s\S]*?)<\/a>/gi,
    (match, before, title, hash, after, content) => {
      // Skip special pages, files, categories, etc.
      if (/^(File|Category|Template|Wikipedia|Help|Portal|Special|Talk|User|Module|MediaWiki|Draft):/i.test(title)) {
        return `<span class="wiki-disabled-link">${content}</span>`;
      }
      const decodedTitle = decodeURIComponent(title.replace(/_/g, ' '));
      return `<a href="javascript:void(0)" class="wiki-link" data-title="${encodeURIComponent(title)}" title="${decodedTitle}">${content}</a>`;
    }
  );

  // Step 2: Rewrite links using /w/index.php?title=... patterns (Wikipedia edit/action links)
  html = html.replace(
    /<a\b[^>]*?href="\/w\/index\.php[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    '<span class="wiki-disabled-link">$1</span>'
  );

  // Step 3: Disable all external links
  html = html.replace(
    /<a\b[^>]*?href="https?:\/\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    '<span class="wiki-disabled-link">$1</span>'
  );

  // Step 4: Remove remaining anchor links (in-page jumps), but keep wiki-links
  html = html.replace(/<a\b[^>]*?href="#[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (match, content) => {
    if (match.includes('class="wiki-link"')) return match;
    return content;
  });

  // Step 5: Disable any remaining <a> tags we didn't catch, but keep wiki-links
  html = html.replace(
    /<a\b[^>]*>([\s\S]*?)<\/a>/gi,
    (match, content) => {
      if (match.includes('class="wiki-link"')) return match;
      return `<span class="wiki-disabled-link">${content}</span>`;
    }
  );

  return html;
}

async function getRandomArticle() {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'random',
    rnnamespace: '0',
    rnlimit: '1',
  });

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });

  const data = await res.json();
  return data.query.random[0].title;
}

async function getRandomPair() {
  // Get two random articles that are reasonably popular
  // Use a curated list approach: get random and verify they have enough links
  let attempts = 0;
  let start, target;

  while (attempts < 5) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'random',
      rnnamespace: '0',
      rnlimit: '10',
    });

    const res = await fetch(`${WIKI_API}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    const data = await res.json();
    const titles = data.query.random.map(r => r.title);

    // Pick two different ones
    start = titles[0];
    target = titles[Math.min(1, titles.length - 1)];

    // Verify they have content
    try {
      const startData = await fetchArticle(start);
      if (startData.links.length >= 5) {
        // Good enough start article
        break;
      }
    } catch (e) {
      // Try again
    }
    attempts++;
  }

  return { start, target };
}

// Search Wikipedia for article title suggestions
async function searchArticles(query) {
  const params = new URLSearchParams({
    action: 'opensearch',
    format: 'json',
    search: query,
    limit: '8',
    namespace: '0',
  });

  const res = await fetch(`${WIKI_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  const data = await res.json();
  return data[1] || []; // Returns array of title strings
}

// ---------- REST API ----------

app.get('/api/wiki/random-pair', async (req, res) => {
  try {
    const pair = await getRandomPair();
    res.json(pair);
  } catch (err) {
    console.error('Random pair error:', err);
    res.status(500).json({ error: 'Failed to get random articles' });
  }
});

app.get('/api/wiki/random', async (req, res) => {
  try {
    const title = await getRandomArticle();
    res.json({ title });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get random article' });
  }
});

app.get('/api/wiki/search', async (req, res) => {
  try {
    const results = await searchArticles(req.query.q || '');
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/wiki/article/:title', async (req, res) => {
  try {
    const article = await fetchArticle(decodeURIComponent(req.params.title));
    res.json(article);
  } catch (err) {
    console.error('Article fetch error:', err);
    res.status(404).json({ error: err.message || 'Article not found' });
  }
});

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ---- Room Management ----

  socket.on('create-room', async ({ playerName, mode, teamCount, autoTeams }, callback) => {
    try {
      const room = gm.createRoom(socket.id, playerName, { mode, teamCount, autoTeams });
      socket.join(room.code);
      callback({ success: true, room: gm.getRoomInfo(room.code) });
      console.log(`[Room] ${playerName} created room ${room.code} (mode: ${mode})`);
    } catch (err) {
      callback({ success: false, error: err.message });
    }
  });

  socket.on('join-room', ({ code, playerName }, callback) => {
    code = (code || '').toUpperCase().trim();
    const result = gm.joinRoom(code, socket.id, playerName);
    if (result.error) {
      callback({ success: false, error: result.error });
      return;
    }
    socket.join(code);
    const roomInfo = gm.getRoomInfo(code);
    callback({ success: true, room: roomInfo });
    socket.to(code).emit('player-joined', roomInfo);
    console.log(`[Room] ${playerName} joined room ${code}`);
  });

  socket.on('leave-room', (callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (code) {
      socket.leave(code);
      const result = gm.leaveRoom(socket.id);
      if (result && !result.destroyed) {
        const roomInfo = gm.getRoomInfo(code);
        io.to(code).emit('player-left', roomInfo);
      }
    }
    if (callback) callback({ success: true });
  });

  socket.on('update-settings', ({ settings }, callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (!code) return callback?.({ success: false });
    const room = gm.rooms.get(code);
    if (!room || room.hostId !== socket.id) return callback?.({ success: false });

    gm.updateSettings(code, settings);
    const roomInfo = gm.getRoomInfo(code);
    io.to(code).emit('settings-updated', roomInfo);
    callback?.({ success: true });
  });

  socket.on('set-team', ({ team }, callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (!code) return callback?.({ success: false });
    gm.setTeam(code, socket.id, team);
    const roomInfo = gm.getRoomInfo(code);
    io.to(code).emit('teams-updated', roomInfo);
    callback?.({ success: true });
  });

  // ---- Game Flow ----

  socket.on('start-game', async ({ customStart, customTarget }, callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (!code) return callback?.({ success: false, error: 'Not in a room' });

    const room = gm.rooms.get(code);
    if (!room || room.hostId !== socket.id) return callback?.({ success: false, error: 'Not the host' });

    try {
      let startTitle, targetTitle;

      if (customStart && customTarget) {
        startTitle = customStart;
        targetTitle = customTarget;
      } else {
        const pair = await getRandomPair();
        startTitle = pair.start;
        targetTitle = pair.target;
      }

      // Verify both articles exist
      const [startArticle, targetArticle] = await Promise.all([
        fetchArticle(startTitle),
        fetchArticle(targetTitle),
      ]);

      gm.startGame(code, startArticle.title, targetArticle.title);

      io.to(code).emit('game-starting', {
        startArticle: startArticle.title,
        targetArticle: targetArticle.title,
        targetDisplayTitle: targetArticle.displayTitle,
        countdown: 3,
      });

      // Countdown
      setTimeout(() => {
        gm.beginPlay(code);
        io.to(code).emit('game-started', {
          startHtml: startArticle.html,
          startTitle: startArticle.title,
          startDisplayTitle: startArticle.displayTitle,
          targetTitle: targetArticle.title,
          targetDisplayTitle: targetArticle.displayTitle,
        });
      }, 3500);

      callback?.({ success: true });
      console.log(`[Game] Room ${code}: ${startArticle.title} → ${targetArticle.title}`);
    } catch (err) {
      console.error('Start game error:', err);
      callback?.({ success: false, error: err.message });
    }
  });

  socket.on('navigate', async ({ title }, callback) => {
    try {
      const article = await fetchArticle(decodeURIComponent(title));
      const result = gm.playerNavigate(socket.id, article.title);

      if (!result) {
        callback?.({ success: false, error: 'Invalid navigation' });
        return;
      }

      const code = gm.playerRooms.get(socket.id);

      // Send article to the navigating player
      callback?.({
        success: true,
        article: {
          title: article.title,
          displayTitle: article.displayTitle,
          html: article.html,
        },
        clicks: result.player.clicks,
        won: result.won,
      });

      // Broadcast progress to room
      if (code) {
        const roomInfo = gm.getRoomInfo(code);
        socket.to(code).emit('player-progress', {
          playerId: socket.id,
          playerName: result.player.name,
          currentArticle: article.title,
          clicks: result.player.clicks,
          finished: result.player.finished,
          time: result.player.finishTime ? result.player.finishTime - result.player.startTime : null,
          room: roomInfo,
        });

        if (result.won) {
          io.to(code).emit('player-finished', {
            playerId: socket.id,
            playerName: result.player.name,
            clicks: result.player.clicks,
            time: result.player.finishTime - result.player.startTime,
          });
        }

        if (result.allFinished) {
          const results = gm.getResults(code);
          io.to(code).emit('game-over', results);
        }
      }
    } catch (err) {
      console.error('Navigate error:', err);
      callback?.({ success: false, error: err.message });
    }
  });

  socket.on('give-up', (callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (!code) return callback?.({ success: false });

    const room = gm.rooms.get(code);
    if (!room) return callback?.({ success: false });

    const player = room.players.get(socket.id);
    if (player) {
      player.finished = true;
      player.finishTime = null; // null time = gave up
    }

    const allFinished = [...room.players.values()].every(p => p.finished || !p.connected);
    if (allFinished) {
      room.state = 'finished';
      const results = gm.getResults(code);
      io.to(code).emit('game-over', results);
    } else {
      io.to(code).emit('player-gave-up', {
        playerId: socket.id,
        playerName: player?.name,
        room: gm.getRoomInfo(code),
      });
    }

    callback?.({ success: true });
  });

  socket.on('end-game', (callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (!code) return callback?.({ success: false });
    const room = gm.rooms.get(code);
    if (!room || room.hostId !== socket.id) return callback?.({ success: false });

    const results = gm.endGame(code);
    io.to(code).emit('game-over', results);
    callback?.({ success: true });
  });

  socket.on('play-again', (callback) => {
    const code = gm.playerRooms.get(socket.id);
    if (!code) return callback?.({ success: false });
    const room = gm.rooms.get(code);
    if (!room || room.hostId !== socket.id) return callback?.({ success: false });

    gm.resetRoom(code);
    const roomInfo = gm.getRoomInfo(code);
    io.to(code).emit('back-to-lobby', roomInfo);
    callback?.({ success: true });
  });

  // ---- Solo Game ----

  socket.on('solo-start', async ({ customStart, customTarget }, callback) => {
    try {
      let startTitle, targetTitle;
      if (customStart && customTarget) {
        startTitle = customStart;
        targetTitle = customTarget;
      } else {
        const pair = await getRandomPair();
        startTitle = pair.start;
        targetTitle = pair.target;
      }

      const [startArticle, targetArticle] = await Promise.all([
        fetchArticle(startTitle),
        fetchArticle(targetTitle),
      ]);

      callback?.({
        success: true,
        startArticle: {
          title: startArticle.title,
          displayTitle: startArticle.displayTitle,
          html: startArticle.html,
        },
        targetArticle: {
          title: targetArticle.title,
          displayTitle: targetArticle.displayTitle,
        },
      });
    } catch (err) {
      console.error('Solo start error:', err);
      callback?.({ success: false, error: err.message });
    }
  });

  socket.on('solo-navigate', async ({ title }, callback) => {
    try {
      const article = await fetchArticle(decodeURIComponent(title));
      callback?.({
        success: true,
        article: {
          title: article.title,
          displayTitle: article.displayTitle,
          html: article.html,
        },
      });
    } catch (err) {
      callback?.({ success: false, error: err.message });
    }
  });

  // ---- Disconnect ----

  socket.on('disconnect', () => {
    const result = gm.disconnectPlayer(socket.id);
    if (result && result.room) {
      const code = result.room.code;
      const roomInfo = gm.getRoomInfo(code);
      if (roomInfo) {
        io.to(code).emit('player-disconnected', roomInfo);
      }
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// ---------- Start Server ----------

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║        🏁 Wikipedia Race Game 🏁         ║
  ║                                          ║
  ║   Server running on port ${String(PORT).padEnd(5)}          ║
  ║   http://localhost:${String(PORT).padEnd(5)}                ║
  ╚══════════════════════════════════════════╝
  `);
});
