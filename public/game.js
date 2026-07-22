const socket = io({ reconnection: true, reconnectionDelay: 500, reconnectionAttempts: Infinity });
const $ = (id) => document.getElementById(id);
const canvas = $('arena');
const ctx = canvas.getContext('2d');
const colors = { bottom:'#42e8ff', left:'#ff5f9e', top:'#ffd75f', right:'#8cff75' };
const sideLabels = { bottom:'Unten', left:'Links', top:'Oben', right:'Rechts' };
let state = null;
let myId = null;
let myToken = null;
let ready = false;
let pressed = new Set();
let latestBall = null;
let renderedBall = null;

socket.on('connect', () => {
  $('connection').textContent = 'Online';
  $('connection').classList.remove('offline');
  const session = loadSession();
  if (session && !myToken) {
    socket.emit('reconnectRoom', session, (result) => {
      if (result.ok) enterRoom(result.code, result.playerId, result.token, false);
      else clearSession();
    });
  }
});

socket.on('disconnect', () => {
  $('connection').textContent = 'Verbindung getrennt – verbinde neu …';
  $('connection').classList.add('offline');
});

socket.on('roomState', (next) => {
  state = next;
  latestBall = next.ball ? { ...next.ball } : null;
  if (!renderedBall && latestBall) renderedBall = { ...latestBall };
  const me = state.players.find((p) => p.token === myToken || p.id === myId);
  if (me) myId = me.id;
  renderUi();
});

function saveSession(code, token) {
  localStorage.setItem('pongArenaSession', JSON.stringify({ code, token }));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('pongArenaSession')); } catch { return null; }
}
function clearSession() { localStorage.removeItem('pongArenaSession'); }

function enterRoom(code, playerId, token, persist = true) {
  myId = playerId;
  myToken = token;
  if (persist) saveSession(code, token);
  $('home').classList.add('hidden');
  $('game').classList.remove('hidden');
  $('roomCode').textContent = code;
}

$('create').onclick = () => {
  $('error').textContent = '';
  socket.emit('createRoom', { name: $('name').value }, (r) => r.ok ? enterRoom(r.code, r.playerId, r.token) : $('error').textContent = r.error);
};
$('join').onclick = () => {
  $('error').textContent = '';
  socket.emit('joinRoom', { code: $('code').value, name: $('name').value }, (r) => r.ok ? enterRoom(r.code, r.playerId, r.token) : $('error').textContent = r.error);
};
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(state?.code || '');
  $('copy').textContent = 'Kopiert';
  setTimeout(() => $('copy').textContent = 'Kopieren', 1200);
};
$('ready').onclick = () => { ready = !ready; socket.emit('setReady', ready); };
$('addBot').onclick = () => socket.emit('addBot', null, (r) => { if (!r.ok) $('gameError').textContent = r.error; });
$('leave').onclick = () => { clearSession(); window.location.reload(); };

function renderUi() {
  if (!state) return;
  const me = state.players.find((p) => p.token === myToken || p.id === myId);
  ready = Boolean(me?.ready);
  $('ready').textContent = ready ? 'Nicht bereit' : 'Bereit';
  $('ready').disabled = !['lobby','finished'].includes(state.status);
  $('addBot').disabled = state.players.length >= 4 || !['lobby','finished'].includes(state.status);
  $('gameError').textContent = '';
  $('players').innerHTML = state.players.map((p) => `
    <div class="player ${!p.connected ? 'disconnected' : ''}">
      <span class="player-dot" style="color:${colors[p.side]};background:${colors[p.side]}"></span>
      <span>${escapeHtml(p.name)}${p.token === myToken ? ' · Du' : ''}${p.isBot ? ' · Bot' : ''}<br><small>${sideLabels[p.side]} · ${p.lives} Leben${!p.connected ? ' · getrennt' : ''}</small></span>
      ${p.isBot && ['lobby','finished'].includes(state.status) ? `<button class="remove-bot" data-token="${p.token}" title="Bot entfernen">×</button>` : `<strong>${p.ready || p.isBot ? '✓' : '–'}</strong>`}
    </div>`).join('');

  document.querySelectorAll('.remove-bot').forEach((button) => {
    button.onclick = () => socket.emit('removeBot', button.dataset.token, (r) => { if (!r.ok) $('gameError').textContent = r.error; });
  });

  const labels = {
    lobby: state.players.length < 2 ? 'Füge einen Mitspieler oder Bot hinzu.' : 'Alle menschlichen Spieler müssen bereit sein.',
    countdown: 'Runde startet …',
    playing: 'Match läuft',
    finished: state.winner ? `${state.winner} gewinnt!` : 'Runde beendet'
  };
  $('statusText').textContent = labels[state.status];
}

function escapeHtml(value) {
  const div = document.createElement('div'); div.textContent = value; return div.innerHTML;
}

function inputDirection() {
  if (pressed.has('ArrowLeft') || pressed.has('KeyA')) return -1;
  if (pressed.has('ArrowRight') || pressed.has('KeyD')) return 1;
  return 0;
}
function sendInput() { socket.emit('input', inputDirection()); }
window.addEventListener('keydown', (e) => { pressed.add(e.code); sendInput(); });
window.addEventListener('keyup', (e) => { pressed.delete(e.code); sendInput(); });
canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect();
  socket.emit('input', e.clientX < r.left + r.width/2 ? -1 : 1);
});
for (const ev of ['pointerup','pointercancel','pointerleave']) canvas.addEventListener(ev, () => socket.emit('input', 0));

function interpolateBall() {
  if (!latestBall) return null;
  if (!renderedBall) renderedBall = { ...latestBall };
  renderedBall.x += (latestBall.x - renderedBall.x) * 0.38;
  renderedBall.y += (latestBall.y - renderedBall.y) * 0.38;
  renderedBall.r = latestBall.r;
  return renderedBall;
}

function draw() {
  requestAnimationFrame(draw);
  const s = state;
  ctx.clearRect(0,0,800,800);
  ctx.fillStyle = '#050817'; ctx.fillRect(0,0,800,800);
  ctx.strokeStyle = 'rgba(89,218,255,.16)'; ctx.lineWidth = 2;
  ctx.setLineDash([8,14]);
  ctx.strokeRect(80,80,640,640);
  ctx.beginPath(); ctx.moveTo(400,0); ctx.lineTo(400,800); ctx.moveTo(0,400); ctx.lineTo(800,400); ctx.stroke();
  ctx.setLineDash([]);
  if (!s) return;

  for (const p of s.players) {
    if (p.lives <= 0) continue;
    ctx.globalAlpha = p.connected ? 1 : 0.35;
    ctx.fillStyle = colors[p.side];
    ctx.shadowColor = colors[p.side]; ctx.shadowBlur = 24;
    if (p.side === 'bottom') ctx.fillRect(p.position-85, 772, 170, 18);
    if (p.side === 'top') ctx.fillRect(p.position-85, 10, 170, 18);
    if (p.side === 'left') ctx.fillRect(10, p.position-85, 18, 170);
    if (p.side === 'right') ctx.fillRect(772, p.position-85, 18, 170);
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  const ball = interpolateBall();
  if (ball) {
    const g = ctx.createRadialGradient(ball.x-3,ball.y-3,2,ball.x,ball.y,18);
    g.addColorStop(0,'#fff'); g.addColorStop(.35,'#65f1ff'); g.addColorStop(1,'rgba(70,116,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ball.x,ball.y,22,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x,ball.y,10,0,Math.PI*2); ctx.fill();
  }

  const overlay = $('overlay');
  if (s.status === 'countdown') {
    overlay.classList.remove('hidden');
    overlay.textContent = Math.max(1, Math.ceil((s.countdownUntil-Date.now())/1000));
  } else if (s.status === 'finished') {
    overlay.classList.remove('hidden'); overlay.textContent = s.winner ? `${s.winner} gewinnt` : 'Game Over';
  } else overlay.classList.add('hidden');
}
draw();
