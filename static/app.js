// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let myId = null;
let myRoomId = null;
let myIsHost = false;
let gameState = null;
let authUsername = null;
let pendingGuestRoomId = null;  // room waiting for guest nickname

const TRAIT_NAMES = {
  gender:          'Пол',
  build:           'Телосложение',
  human_trait:     'Человеческая черта',
  profession:      'Профессия',
  health:          'Здоровье',
  hobby:           'Хобби / Увлечение',
  phobia:          'Фобия / Страх',
  large_inventory: 'Крупный инвентарь',
  backpack:        'Рюкзак',
  additional_fact: 'Доп. сведение',
  special_ability: 'Спец. возможность',
};

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS(onOpen) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnDot(true);
    if (onOpen) onOpen();
  };

  ws.onclose = () => {
    setConnDot(false);
    notify('Соединение потеряно. Обновите страницу.', 'error', 5000);
  };

  ws.onerror = () => {
    notify('Ошибка подключения', 'error');
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(msg);
  };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function ensureWS(onReady) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (onReady) onReady();
    return;
  }
  connectWS(onReady);
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      myId = msg.player_id;
      myRoomId = msg.room_id;
      myIsHost = msg.is_host;
      document.getElementById('room-code-display').textContent = myRoomId;
      showScreen('lobby');
      break;

    case 'auth_ok':
      authUsername = msg.username;
      updateAuthUI();
      notify(msg.message || `Вход выполнен: ${authUsername}`, 'success');
      if (codeParam) showJoin();
      break;

    case 'need_guest_name':
      // Server wants a nickname for guest join
      pendingGuestRoomId = msg.room_id;
      openGuestModal();
      break;

    case 'state':
      gameState = msg.data;
      renderState();
      break;

    case 'error':
      notify(msg.message, 'error');
      break;

    case 'game_started':
      notify('Игра началась! Карточки розданы.', 'success');
      break;

    case 'trait_revealed':
      if (msg.data && msg.data.player_id !== myId) {
        notify(`${msg.data.player_name} раскрыл: ${TRAIT_NAMES[msg.data.trait_key] || msg.data.trait_key}`, 'info');
      }
      break;

    case 'voting_started':
      notify('⚡ Голосование началось! Выберите кандидата на исключение.', 'error');
      break;

    case 'player_eliminated':
      notify(`🚪 ${msg.player_name} исключён из бункера.`, 'error', 4000);
      break;

    case 'no_elimination':
      notify('Голоса не совпали — никто не исключён.', 'info');
      break;

    case 'game_over':
      break;

    case 'game_restarted':
      notify('Новая игра!', 'success');
      break;

    case 'player_left':
      notify(`${msg.player_name} покинул игру`, 'info');
      break;
  }
}

function updateAuthUI() {
  const status = document.getElementById('auth-status');
  const uname = authUsername || '—';
  status.textContent = authUsername
    ? `Авторизованы как: ${authUsername}`
    : 'Войдите или зарегистрируйтесь чтобы создавать комнаты';
  document.getElementById('create-account-name').textContent = uname;
  document.getElementById('join-account-name').textContent = authUsername || '(гость)';
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderState() {
  if (!gameState) return;
  const phase = gameState.phase;

  if (phase === 'lobby') {
    showScreen('lobby');
    renderLobby();
  } else if (phase === 'playing' || phase === 'voting') {
    showScreen('game');
    renderGame();
  } else if (phase === 'finished') {
    showScreen('game');
    renderGame();
    showScreen('over');
    renderOver();
  }
}

function renderLobby() {
  if (!gameState) return;
  const container = document.getElementById('lobby-players');
  container.innerHTML = gameState.players.map(p => `
    <div class="player-item ${p.id === myId ? 'you' : 'alive'}">
      <span class="player-name">${esc(p.name)}</span>
      ${p.is_host ? '<span class="player-badge host">Хост</span>' : ''}
      ${p.id === myId ? '<span class="player-badge">Вы</span>' : ''}
    </div>
  `).join('');

  document.getElementById('host-start').style.display = myIsHost ? 'block' : 'none';
  document.getElementById('wait-start').style.display = myIsHost ? 'none' : 'block';
}

function renderGame() {
  if (!gameState) return;
  const phase = gameState.phase;
  const isVoting = phase === 'voting';

  // Phase badge
  const badge = document.getElementById('phase-badge');
  badge.className = `phase-badge ${isVoting ? 'voting' : 'playing'}`;
  badge.textContent = isVoting ? '● Голосование' : '● Обсуждение';

  // Scenario
  const s = gameState.scenario;
  document.getElementById('scenario-box').innerHTML = `
    <div class="scenario-name">⚠ ${esc(s.name || '')}</div>
    <div class="scenario-desc">${esc(s.description || '')}</div>
    <div class="bunker-capacity">${esc(s.bunker || '')}</div>
  `;

  // Stats
  document.getElementById('stat-round').textContent = gameState.round;
  document.getElementById('stat-alive').textContent = gameState.alive_count;
  document.getElementById('stat-capacity').textContent = gameState.bunker_capacity;

  // My card
  const me = gameState.players.find(p => p.id === myId);
  if (me && me.card) {
    document.getElementById('my-name-display').textContent = me.name;
    const traitsHtml = Object.entries(TRAIT_NAMES).map(([key, label]) => {
      const revealed = me.revealed_traits.includes(key);
      const value = me.card[key] || '—';
      return `
        <div class="trait-item ${revealed ? 'revealed' : ''}">
          <div class="trait-label">${label}</div>
          <div class="trait-value">${esc(value)}</div>
          <button
            title="${revealed ? 'Скрыть от других' : 'Показать другим'}"
            onclick="event.stopPropagation(); ${revealed ? `doHide('${key}')` : `doReveal('${key}')`}"
            class="trait-action"
          >👁</button>
        </div>
      `;
    }).join('');
    document.getElementById('my-traits').innerHTML = traitsHtml;
  }

  // Players list
  const myVote = (gameState.votes || []).find(v => v.voter_id === myId);
  const voteCounts = {};
  (gameState.votes || []).forEach(v => {
    voteCounts[v.target_id] = (voteCounts[v.target_id] || 0) + 1;
  });

  const playersHtml = gameState.players.map(p => {
    const alive = p.is_alive;
    const votedFor = myVote && myVote.target_id === p.id;
    const vcount = voteCounts[p.id] || 0;

    let revealedInfo = '';
    if (p.revealed_card && Object.keys(p.revealed_card).length > 0) {
      revealedInfo = Object.entries(p.revealed_card).map(([k, v]) =>
        `<span style="font-size:10px; color:var(--text-dim);">${TRAIT_NAMES[k]}: </span><span style="font-size:10px; color:var(--text-bright); font-family:var(--stamp);">${esc(v)}</span>`
      ).join(' &nbsp;·&nbsp; ');
    }

    return `
      <div class="player-item ${alive ? 'alive' : 'dead'} ${votedFor ? 'voted-for' : ''}"
           ${isVoting && alive ? `onclick="doVote('${p.id}')" style="cursor:pointer;"` : ''}>
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span class="player-name">${esc(p.name)}</span>
            ${p.is_host ? '<span class="player-badge host">Хост</span>' : ''}
            ${p.id === myId ? '<span class="player-badge">Вы</span>' : ''}
            ${!alive ? '<span class="player-badge" style="color:var(--danger);">Исключён</span>' : ''}
          </div>
          ${revealedInfo ? `<div style="margin-top:4px; line-height:1.6;">${revealedInfo}</div>` : ''}
        </div>
        ${isVoting && alive && p.id !== myId ? `<span class="vote-count">${vcount > 0 ? '▲'.repeat(vcount) : ''}</span>` : ''}
        ${isVoting && alive && p.id !== myId ? `<button class="btn vote-btn ${votedFor ? 'btn-danger' : 'btn-ghost'}" onclick="event.stopPropagation(); doVote('${p.id}')">
          ${votedFor ? '✓ Мой голос' : 'Голос'}
        </button>` : ''}
        ${myIsHost ? `<button class="btn vote-btn btn-ghost" style="border-color:#5a5a3a; color:#c8a84b; font-size:10px;" onclick="event.stopPropagation(); openEditModal('${p.id}', ${JSON.stringify(p.name)})">✎ Изменить</button>` : ''}
      </div>
    `;
  }).join('');
  document.getElementById('players-list').innerHTML = playersHtml;

  // Revealed table
  const columns = Object.entries(TRAIT_NAMES);
  const header = `
    <tr>
      <th>Игрок</th>
      ${columns.map(([, label]) => `<th>${esc(label)}</th>`).join('')}
    </tr>
  `;
  const rows = gameState.players.map(p => {
    return `
      <tr>
        <td>${esc(p.name)}${p.id === myId ? ' (вы)' : ''}${p.is_alive ? '' : ' [исключён]'}</td>
        ${columns.map(([key]) => {
          const isMine = p.id === myId;
          const isRevealed = (p.revealed_traits || []).includes(key);
          const val = isMine || isRevealed ? (p.card?.[key] || p.revealed_card?.[key] || '—') : '—';
          return `<td class="${isMine || isRevealed ? '' : 'muted'}">${esc(val)}</td>`;
        }).join('')}
      </tr>
    `;
  }).join('');
  document.getElementById('revealed-table').innerHTML = header + rows;

  // Host controls
  const hostCtrl = document.getElementById('host-controls');
  hostCtrl.style.display = myIsHost ? 'flex' : 'none';
  if (myIsHost) {
    hostCtrl.style.flexDirection = 'column';
    document.getElementById('btn-start-vote').style.display = isVoting ? 'none' : 'inline-flex';
    document.getElementById('btn-end-vote').style.display = isVoting ? 'inline-flex' : 'none';
  }

  // Reveal log
  const log = (gameState.reveal_log || []).slice().reverse();
  document.getElementById('reveal-log').innerHTML = log.length
    ? log.map(e => `
        <div class="log-entry">
          <span class="log-who">${esc(e.player_name)}</span>
          <span class="log-trait"> раскрыл ${TRAIT_NAMES[e.trait_key] || e.trait_key}: </span>
          <span class="log-value">${esc(e.trait_value)}</span>
        </div>
      `).join('')
    : '<div class="log-entry" style="color:var(--text-dim);">Пока ничего не раскрыто</div>';
}

function renderOver() {
  const won = gameState.winner === 'survivors';
  const title = document.getElementById('over-title');
  const sub = document.getElementById('over-sub');

  title.textContent = won ? 'ВЫЖИЛИ' : 'ПОГИБЛИ';
  title.className = `game-over-title ${won ? 'win' : 'lose'}`;
  sub.textContent = won
    ? 'Оставшиеся попали в бункер. Человечество продолжится.'
    : 'Бункер так и не был заполнен правильными людьми.';

  const overPlayers = document.getElementById('over-players');
  overPlayers.innerHTML = gameState.players.map(p => `
    <div class="player-item ${p.is_alive ? 'alive' : 'dead'}">
      <span class="player-name">${esc(p.name)}</span>
      ${p.is_alive ? '<span class="player-badge" style="color:var(--green);">В бункере</span>' : '<span class="player-badge" style="color:var(--danger);">Исключён</span>'}
    </div>
  `).join('');

  document.getElementById('host-restart').style.display = myIsHost ? 'block' : 'none';
}

// ── Actions ────────────────────────────────────────────────────────────────
function showCreate() {
  if (!authUsername) { notify('Создавать комнаты могут только зарегистрированные пользователи', 'error'); return; }
  document.getElementById('create-form').style.display = 'block';
  document.getElementById('join-form').style.display = 'none';
}

function showJoin() {
  document.getElementById('join-form').style.display = 'block';
  document.getElementById('create-form').style.display = 'none';
  document.getElementById('join-code').focus();
}

function hideAll() {
  document.getElementById('create-form').style.display = 'none';
  document.getElementById('join-form').style.display = 'none';
}

function doCreate() {
  if (!authUsername) { notify('Сначала войдите в аккаунт', 'error'); return; }
  ensureWS(() => send({ action: 'create_room' }));
}

function doJoin() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code || code.length !== 6) { notify('Введите 6-значный код', 'error'); return; }
  // No auth check — guests allowed, server will ask for nickname if needed
  ensureWS(() => send({ action: 'join_room', room_id: code }));
}

function doAuth(mode) {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  if (!username) { notify('Введите логин', 'error'); return; }
  if (!password) { notify('Введите пароль', 'error'); return; }
  ensureWS(() => send({
    action: mode === 'register' ? 'register' : 'login',
    username,
    password
  }));
}

function doStart() { send({ action: 'start_game' }); }
function doStartVoting() { send({ action: 'start_voting' }); }
function doEndVoting() { send({ action: 'end_voting' }); }
function doReveal(trait) { send({ action: 'reveal_trait', trait }); }
function doHide(trait) { send({ action: 'hide_trait', trait }); }
function doVote(targetId) { send({ action: 'vote', target_id: targetId }); }
function doRestart() { send({ action: 'restart' }); }

function copyCode() {
  const code = document.getElementById('room-code-display').textContent;
  navigator.clipboard.writeText(code).then(() => notify('Код скопирован: ' + code, 'success'));
}

// ── Guest nickname modal ────────────────────────────────────────────────────
function openGuestModal() {
  document.getElementById('guest-modal').style.display = 'flex';
  document.getElementById('guest-nick-input').value = '';
  setTimeout(() => document.getElementById('guest-nick-input').focus(), 50);
}

function closeGuestModal() {
  document.getElementById('guest-modal').style.display = 'none';
  pendingGuestRoomId = null;
}

function submitGuestNick() {
  const nick = document.getElementById('guest-nick-input').value.trim();
  if (!nick) { notify('Введите ник', 'error'); return; }
  if (!pendingGuestRoomId) return;
  const rid = pendingGuestRoomId;
  pendingGuestRoomId = null;
  closeGuestModal();
  ensureWS(() => send({ action: 'join_room', room_id: rid, guest_name: nick }));
}

document.getElementById('guest-modal').addEventListener('click', function(e) {
  if (e.target === this) closeGuestModal();
});

// ── UI helpers ─────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

function setConnDot(on) {
  const dot = document.getElementById('conn-dot');
  if (dot) dot.className = 'conn-dot' + (on ? '' : ' off');
}

let notifyTimer = null;
function notify(text, type = 'info', duration = 3000) {
  const el = document.getElementById('notification');
  el.textContent = text;
  el.className = `show ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => { el.className = ''; }, duration);
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── URL code pre-fill ──────────────────────────────────────────────────────
const urlParams = new URLSearchParams(location.search);
const codeParam = urlParams.get('room');
if (codeParam) {
  document.getElementById('join-code').value = codeParam.toUpperCase();
}
updateAuthUI();

// Enter key handlers
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const active = document.activeElement?.id || '';
    if (active === 'auth-username' || active === 'auth-password') doAuth('login');
    else if (active === 'guest-nick-input') submitGuestNick();
    else if (document.getElementById('create-form').style.display !== 'none') doCreate();
    else if (document.getElementById('join-form').style.display !== 'none') doJoin();
  }
});
