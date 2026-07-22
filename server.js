import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 10000, pingInterval: 5000 });

const PORT = process.env.PORT || 3000;
const TICK_RATE = 60;
const ARENA_SIZE = 800;
const PADDLE_LENGTH = 170;
const PADDLE_THICKNESS = 18;
const PADDLE_SPEED = 560;
const BALL_RADIUS = 11;
const BALL_START_SPEED = 360;
const BALL_MAX_SPEED = 760;
const MAX_PLAYERS = 4;
const STARTING_LIVES = 5;
const RECONNECT_GRACE_MS = 30000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const sideOrder = ['bottom', 'left', 'top', 'right'];

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(code) ? makeCode() : code;
}

function createRoom(code) {
  const room = {
    code,
    players: new Map(),
    status: 'lobby',
    ball: null,
    winner: null,
    countdownUntil: null,
    lastUpdate: Date.now(),
    botCounter: 0
  };
  rooms.set(code, room);
  return room;
}

function resetBall(room, direction = null) {
  const angle = direction ?? (Math.random() * Math.PI * 2);
  room.ball = {
    x: ARENA_SIZE / 2,
    y: ARENA_SIZE / 2,
    vx: Math.cos(angle) * BALL_START_SPEED,
    vy: Math.sin(angle) * BALL_START_SPEED,
    r: BALL_RADIUS
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    status: room.status,
    winner: room.winner,
    countdownUntil: room.countdownUntil,
    arenaSize: ARENA_SIZE,
    players: [...room.players.values()].map(({ id, token, name, side, ready, position, lives, connected, isBot }) => ({
      id, token, name, side, ready, position, lives, connected, isBot
    })),
    ball: room.ball
  };
}

function broadcast(room) {
  io.to(room.code).emit('roomState', publicRoom(room));
}

function assignSide(room) {
  const used = new Set([...room.players.values()].map((p) => p.side));
  return sideOrder.find((side) => !used.has(side));
}

function normaliseName(name) {
  return String(name || 'Spieler').trim().slice(0, 18) || 'Spieler';
}

function addHumanPlayer(socket, room, name) {
  if (room.players.size >= MAX_PLAYERS) throw new Error('Dieser Raum ist bereits voll.');
  if (room.status !== 'lobby') throw new Error('Das Spiel in diesem Raum läuft bereits.');
  const side = assignSide(room);
  const player = {
    id: socket.id,
    token: crypto.randomUUID(),
    name: normaliseName(name),
    side,
    ready: false,
    position: ARENA_SIZE / 2,
    input: 0,
    lives: STARTING_LIVES,
    connected: true,
    disconnectedAt: null,
    isBot: false
  };
  room.players.set(player.token, player);
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerToken = player.token;
  return player;
}

function addBot(room) {
  if (room.players.size >= MAX_PLAYERS) throw new Error('Der Raum ist bereits voll.');
  if (!['lobby', 'finished'].includes(room.status)) throw new Error('Bots können nur vor einer Runde hinzugefügt werden.');
  const side = assignSide(room);
  room.botCounter += 1;
  const token = `bot-${room.code}-${room.botCounter}`;
  const player = {
    id: token,
    token,
    name: `Bot ${room.botCounter}`,
    side,
    ready: true,
    position: ARENA_SIZE / 2,
    input: 0,
    lives: STARTING_LIVES,
    connected: true,
    disconnectedAt: null,
    isBot: true
  };
  room.players.set(token, player);
  return player;
}

function activePlayers(room) {
  return [...room.players.values()].filter((p) => p.lives > 0 && (p.connected || p.isBot));
}

function startGame(room) {
  if (room.players.size < 2) return;
  room.status = 'countdown';
  room.winner = null;
  for (const p of room.players.values()) {
    p.lives = STARTING_LIVES;
    p.position = ARENA_SIZE / 2;
    p.input = 0;
  }
  resetBall(room);
  room.ball.vx = 0;
  room.ball.vy = 0;
  room.countdownUntil = Date.now() + 3000;
  broadcast(room);
}

function launchBall(room) {
  const angle = Math.random() * Math.PI * 2;
  room.ball.vx = Math.cos(angle) * BALL_START_SPEED;
  room.ball.vy = Math.sin(angle) * BALL_START_SPEED;
  room.status = 'playing';
  room.countdownUntil = null;
}

function sidePlayer(room, side) {
  return [...room.players.values()].find((p) => p.side === side && p.lives > 0 && (p.connected || p.isBot));
}

function paddleHit(player, coordinate) {
  return player && Math.abs(coordinate - player.position) <= PADDLE_LENGTH / 2 + BALL_RADIUS;
}

function capBallSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed > BALL_MAX_SPEED) {
    const factor = BALL_MAX_SPEED / speed;
    ball.vx *= factor;
    ball.vy *= factor;
  }
}

function bounceFromPaddle(ball, player, coordinate, horizontalWall) {
  const offset = Math.max(-1, Math.min(1, (coordinate - player.position) / (PADDLE_LENGTH / 2)));
  const currentSpeed = Math.min(BALL_MAX_SPEED, Math.hypot(ball.vx, ball.vy) * 1.045);
  const angle = offset * (Math.PI / 3);

  if (horizontalWall) {
    const direction = ball.vy > 0 ? -1 : 1;
    ball.vx = Math.sin(angle) * currentSpeed;
    ball.vy = Math.cos(angle) * currentSpeed * direction;
  } else {
    const direction = ball.vx > 0 ? -1 : 1;
    ball.vx = Math.cos(angle) * currentSpeed * direction;
    ball.vy = Math.sin(angle) * currentSpeed;
  }
  capBallSpeed(ball);
}

function loseLife(room, side) {
  const player = sidePlayer(room, side);
  if (player) player.lives = Math.max(0, player.lives - 1);

  const remaining = activePlayers(room);
  if (remaining.length <= 1) {
    room.status = 'finished';
    room.winner = remaining[0]?.name || null;
    room.ball.vx = 0;
    room.ball.vy = 0;
    for (const p of room.players.values()) p.ready = p.isBot;
    return;
  }

  resetBall(room);
  room.ball.vx = 0;
  room.ball.vy = 0;
  room.status = 'countdown';
  room.countdownUntil = Date.now() + 1800;
}

function updateBot(player, room, dt) {
  if (!room.ball || room.status !== 'playing' || player.lives <= 0) {
    player.input = 0;
    return;
  }
  const target = ['top', 'bottom'].includes(player.side) ? room.ball.x : room.ball.y;
  const deadZone = 18;
  const delta = target - player.position;
  player.input = Math.abs(delta) < deadZone ? 0 : Math.sign(delta);
  const botSpeedFactor = 0.78;
  player.position += player.input * PADDLE_SPEED * botSpeedFactor * dt;
}

function updateRoom(room, dt) {
  for (const p of room.players.values()) {
    if (p.isBot) updateBot(p, room, dt);
    else p.position += p.input * PADDLE_SPEED * dt;
    const min = PADDLE_LENGTH / 2;
    const max = ARENA_SIZE - PADDLE_LENGTH / 2;
    p.position = Math.max(min, Math.min(max, p.position));
  }

  if (room.status === 'countdown' && Date.now() >= room.countdownUntil) launchBall(room);
  if (room.status !== 'playing' || !room.ball) return;

  const b = room.ball;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy) * dt / (BALL_RADIUS * 0.75)));
  const stepDt = dt / steps;

  for (let i = 0; i < steps && room.status === 'playing'; i += 1) {
    b.x += b.vx * stepDt;
    b.y += b.vy * stepDt;

    const left = PADDLE_THICKNESS + BALL_RADIUS;
    const right = ARENA_SIZE - PADDLE_THICKNESS - BALL_RADIUS;
    const top = PADDLE_THICKNESS + BALL_RADIUS;
    const bottom = ARENA_SIZE - PADDLE_THICKNESS - BALL_RADIUS;

    if (b.x <= left && b.vx < 0) {
      const p = sidePlayer(room, 'left');
      if (paddleHit(p, b.y)) {
        b.x = left;
        bounceFromPaddle(b, p, b.y, false);
      } else if (b.x < -BALL_RADIUS) loseLife(room, 'left');
    }
    if (b.x >= right && b.vx > 0) {
      const p = sidePlayer(room, 'right');
      if (paddleHit(p, b.y)) {
        b.x = right;
        bounceFromPaddle(b, p, b.y, false);
      } else if (b.x > ARENA_SIZE + BALL_RADIUS) loseLife(room, 'right');
    }
    if (b.y <= top && b.vy < 0) {
      const p = sidePlayer(room, 'top');
      if (paddleHit(p, b.x)) {
        b.y = top;
        bounceFromPaddle(b, p, b.x, true);
      } else if (b.y < -BALL_RADIUS) loseLife(room, 'top');
    }
    if (b.y >= bottom && b.vy > 0) {
      const p = sidePlayer(room, 'bottom');
      if (paddleHit(p, b.x)) {
        b.y = bottom;
        bounceFromPaddle(b, p, b.x, true);
      } else if (b.y > ARENA_SIZE + BALL_RADIUS) loseLife(room, 'bottom');
    }
  }
}

function getSocketPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.get(socket.data.playerToken);
  return { room, player };
}

function reconnectPlayer(socket, code, token) {
  const room = rooms.get(String(code || '').trim().toUpperCase());
  const player = room?.players.get(token);
  if (!room || !player || player.isBot) throw new Error('Sitzplatz konnte nicht wiederhergestellt werden.');
  if (player.connected) throw new Error('Dieser Spieler ist bereits verbunden.');
  player.id = socket.id;
  player.connected = true;
  player.disconnectedAt = null;
  player.input = 0;
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerToken = player.token;
  return { room, player };
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, reply) => {
    try {
      const room = createRoom(makeCode());
      const player = addHumanPlayer(socket, room, name);
      reply?.({ ok: true, code: room.code, playerId: player.id, token: player.token });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on('joinRoom', ({ code, name }, reply) => {
    try {
      const normalized = String(code || '').trim().toUpperCase();
      const room = rooms.get(normalized);
      if (!room) throw new Error('Raum nicht gefunden.');
      const player = addHumanPlayer(socket, room, name);
      reply?.({ ok: true, code: room.code, playerId: player.id, token: player.token });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on('reconnectRoom', ({ code, token }, reply) => {
    try {
      const { room, player } = reconnectPlayer(socket, code, token);
      reply?.({ ok: true, code: room.code, playerId: player.id, token: player.token });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on('addBot', (_, reply) => {
    try {
      const { room } = getSocketPlayer(socket);
      if (!room) throw new Error('Kein aktiver Raum.');
      addBot(room);
      reply?.({ ok: true });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on('removeBot', (token, reply) => {
    try {
      const { room } = getSocketPlayer(socket);
      const bot = room?.players.get(token);
      if (!room || !bot?.isBot) throw new Error('Bot nicht gefunden.');
      if (!['lobby', 'finished'].includes(room.status)) throw new Error('Bots können während einer Runde nicht entfernt werden.');
      room.players.delete(token);
      reply?.({ ok: true });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on('setReady', (ready) => {
    const { room, player } = getSocketPlayer(socket);
    if (!room || !player || !['lobby', 'finished'].includes(room.status)) return;
    player.ready = Boolean(ready);
    const players = [...room.players.values()];
    if (players.length >= 2 && players.every((p) => p.ready || p.isBot)) startGame(room);
    else broadcast(room);
  });

  socket.on('input', (direction) => {
    const { player } = getSocketPlayer(socket);
    if (!player || player.isBot) return;
    player.input = Math.max(-1, Math.min(1, Number(direction) || 0));
  });

  socket.on('disconnect', () => {
    const { room, player } = getSocketPlayer(socket);
    if (!room || !player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.input = 0;
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const [token, player] of room.players.entries()) {
      if (!player.isBot && !player.connected && player.disconnectedAt && now - player.disconnectedAt > RECONNECT_GRACE_MS) {
        room.players.delete(token);
      }
    }

    if (room.players.size === 0) {
      rooms.delete(room.code);
      continue;
    }

    if (!['lobby', 'finished'].includes(room.status) && activePlayers(room).length <= 1) {
      room.status = 'finished';
      room.winner = activePlayers(room)[0]?.name || null;
      if (room.ball) {
        room.ball.vx = 0;
        room.ball.vy = 0;
      }
    }

    const dt = Math.min((now - room.lastUpdate) / 1000, 0.05);
    room.lastUpdate = now;
    updateRoom(room, dt);
    if (room.status !== 'lobby') broadcast(room);
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Pong Arena V2 läuft auf http://localhost:${PORT}`);
});
