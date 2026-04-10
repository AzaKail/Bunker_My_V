// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let myId = null;
let myRoomId = null;
let myIsHost = false;
let gameState = null;
let authUsername = null;
let pendingGuestRoomId = null;

const TRAIT_NAMES = {
  race:            'Раса',
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

// Trait keys that have descriptions

// ── WebSocket ──────────────────────────────────────────────────────────────
function connectWS(onOpen) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => { setConnDot(true); if (onOpen) onOpen(); };
  ws.onclose = () => { setConnDot(false); notify('Соединение потеряно. Обновите страницу.', 'error', 5000); };
  ws.onerror = () => notify('Ошибка подключения', 'error');
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function ensureWS(onReady) {
  if (ws && ws.readyState === WebSocket.OPEN) { if (onReady) onReady(); return; }
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
      if (msg.data && msg.data.player_id !== myId)
        notify(`${msg.data.player_name} раскрыл: ${TRAIT_NAMES[msg.data.trait_key] || msg.data.trait_key}`, 'info');
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
    case 'game_restarted':
      notify('Новая игра!', 'success');
      break;
    case 'player_left':
      notify(`${msg.player_name} покинул игру`, 'info');
      break;
  }
}

function updateAuthUI() {
  document.getElementById('auth-status').textContent = authUsername
    ? `Авторизованы как: ${authUsername}`
    : 'Войдите или зарегистрируйтесь чтобы создавать комнаты';
  document.getElementById('create-account-name').textContent = authUsername || '—';
  document.getElementById('join-account-name').textContent = authUsername || '(гость)';
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderState() {
  if (!gameState) return;
  const phase = gameState.phase;
  if (phase === 'lobby') { showScreen('lobby'); renderLobby(); }
  else if (phase === 'playing' || phase === 'voting') { showScreen('game'); renderGame(); }
  else if (phase === 'finished') { showScreen('game'); renderGame(); showScreen('over'); renderOver(); }
}

function renderLobby() {
  if (!gameState) return;
  document.getElementById('lobby-players').innerHTML = gameState.players.map(p => `
    <div class="player-item ${p.id === myId ? 'you' : 'alive'}">
      <span class="player-name">${esc(p.name)}</span>
      ${p.is_host ? '<span class="player-badge host">Хост</span>' : ''}
      ${p.id === myId ? '<span class="player-badge">Вы</span>' : ''}
    </div>
  `).join('');
  document.getElementById('host-start').style.display = myIsHost ? 'block' : 'none';
  document.getElementById('wait-start').style.display = myIsHost ? 'none' : 'block';
}

// ── Tooltip helpers ────────────────────────────────────────────────────────
let tooltipTimer = null;
let activeTooltip = null;

function attachTooltip(el, text) {
  if (!text) return;
  el.addEventListener('mouseenter', () => {
    tooltipTimer = setTimeout(() => {
      removeTooltip();
      const tip = document.createElement('div');
      tip.className = 'trait-tooltip';
      tip.textContent = text;
      document.body.appendChild(tip);
      const r = el.getBoundingClientRect();
      tip.style.left = r.left + 'px';
      tip.style.top = (r.bottom + 6 + window.scrollY) + 'px';
      // keep within viewport
      const tipR = tip.getBoundingClientRect();
      if (tipR.right > window.innerWidth - 8)
        tip.style.left = (window.innerWidth - tipR.width - 8) + 'px';
      activeTooltip = tip;
    }, 1200);
  });
  el.addEventListener('mouseleave', () => {
    clearTimeout(tooltipTimer);
    removeTooltip();
  });
}

function removeTooltip() {
  if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
}

function makeValueWithTooltip(key, value) {
  const desc = (typeof ALL_DESCRIPTIONS !== 'undefined') ? ALL_DESCRIPTIONS[value] : null;
  if (!desc || !DESCRIBED_TRAITS.includes(key)) return esc(value);
  // return span that will get tooltip attached after insertion
  return `<span class="has-tooltip" data-tip="${esc(desc)}">${esc(value)} <span class="tip-icon">ℹ</span></span>`;
}

function activateTooltips(container) {
  container.querySelectorAll('.has-tooltip').forEach(el => {
    attachTooltip(el, el.dataset.tip);
  });
}

// ── Main game render ───────────────────────────────────────────────────────
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

  // My card — with tooltips on profession & special_ability
  const me = gameState.players.find(p => p.id === myId);
  if (me && me.card) {
    document.getElementById('my-name-display').textContent = me.name;
    const myCardEl = document.getElementById('my-traits');
    myCardEl.innerHTML = Object.entries(TRAIT_NAMES).map(([key, label]) => {
      const revealed = me.revealed_traits.includes(key);
      const value = me.card[key] || '—';
      return `
        <div class="trait-item ${revealed ? 'revealed' : ''}">
          <div class="trait-label">${label}</div>
          <div class="trait-value">${makeValueWithTooltip(key, value)}</div>
          <button
            title="${revealed ? 'Скрыть от других' : 'Показать другим'}"
            onclick="event.stopPropagation(); ${revealed ? `doHide('${key}')` : `doReveal('${key}')`}"
            class="trait-action"
          >👁</button>
        </div>
      `;
    }).join('');
    activateTooltips(myCardEl);
  }

  // Players list
  const myVote = (gameState.votes || []).find(v => v.voter_id === myId);
  const voteCounts = {};
  (gameState.votes || []).forEach(v => { voteCounts[v.target_id] = (voteCounts[v.target_id] || 0) + 1; });

  document.getElementById('players-list').innerHTML = gameState.players.map(p => {
    const alive = p.is_alive;
    const votedFor = myVote && myVote.target_id === p.id;
    const vcount = voteCounts[p.id] || 0;
    let revealedInfo = '';
    if (p.revealed_card && Object.keys(p.revealed_card).length > 0) {
      revealedInfo = Object.entries(p.revealed_card).map(([k, v]) =>
        `<span style="font-size:10px;color:var(--text-dim);">${TRAIT_NAMES[k]}: </span><span style="font-size:10px;color:var(--text-bright);font-family:var(--stamp);">${esc(v)}</span>`
      ).join(' &nbsp;·&nbsp; ');
    }
    return `
      <div class="player-item ${alive ? 'alive' : 'dead'} ${votedFor ? 'voted-for' : ''}"
           ${isVoting && alive ? `onclick="doVote('${p.id}')" style="cursor:pointer;"` : ''}>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span class="player-name">${esc(p.name)}</span>
            ${p.is_host ? '<span class="player-badge host">Хост</span>' : ''}
            ${p.id === myId ? '<span class="player-badge">Вы</span>' : ''}
            ${!alive ? '<span class="player-badge" style="color:var(--danger);">Исключён</span>' : ''}
          </div>
          ${revealedInfo ? `<div style="margin-top:4px;line-height:1.6;">${revealedInfo}</div>` : ''}
        </div>
        ${isVoting && alive && p.id !== myId ? `<span class="vote-count">${vcount > 0 ? '▲'.repeat(vcount) : ''}</span>` : ''}
        ${isVoting && alive && p.id !== myId ? `<button class="btn vote-btn ${votedFor ? 'btn-danger' : 'btn-ghost'}" onclick="event.stopPropagation();doVote('${p.id}')">${votedFor ? '✓ Мой голос' : 'Голос'}</button>` : ''}
        ${myIsHost && !isVoting ? `<button class="btn vote-btn btn-ghost" style="border-color:#4a4a2a;color:var(--accent);font-size:10px;margin-left:auto;" onclick="event.stopPropagation();openFullEditModal('${p.id}')">✎</button>` : ''}
      </div>
    `;
  }).join('');

  // ── Revealed table — only revealed data (not mine by default) ──
  renderRevealedTable();

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
        </div>`).join('')
    : '<div class="log-entry" style="color:var(--text-dim);">Пока ничего не раскрыто</div>';
}

// ── Revealed table: only publicly revealed traits ──────────────────────────
function renderRevealedTable() {
  if (!gameState) return;
  const columns = Object.entries(TRAIT_NAMES);
  const tableEl = document.getElementById('revealed-table');

  // Хост видит все колонки, остальные — только раскрытые
  const visibleCols = myIsHost
    ? columns
    : columns.filter(([key]) =>
        gameState.players.some(p => (p.revealed_traits || []).includes(key))
      );

  if (visibleCols.length === 0) {
    tableEl.innerHTML = `
      <tr><td colspan="2" style="color:var(--text-dim);padding:16px;text-align:center;letter-spacing:2px;font-size:11px;">
        Никто ещё ничего не раскрыл
      </td></tr>`;
    return;
  }

  const header = `<tr>
    <th>Игрок</th>
    ${visibleCols.map(([, label]) => `<th>${esc(label)}</th>`).join('')}
  </tr>`;

  const rows = gameState.players.map(p => {
    // Хост видит все строки, остальные — только тех у кого есть хоть одно раскрытие
    if (!myIsHost) {
      const hasAny = visibleCols.some(([key]) => (p.revealed_traits || []).includes(key));
      if (!hasAny) return '';
    }

    const cells = visibleCols.map(([key]) => {
      const isRevealed = (p.revealed_traits || []).includes(key);
      const val = p.revealed_card?.[key] || p.card?.[key] || '—';

      // Не раскрытая ячейка: хост может редактировать, остальные видят «—»
      if (!isRevealed) {
        if (myIsHost) {
          return `<td class="muted host-editable" onclick="hostEditCell('${p.id}','${key}')" style="cursor:pointer;" title="Нажмите чтобы изменить">—</td>`;
        }
        return `<td class="muted">—</td>`;
      }

      // Раскрытая ячейка
      const editAttr = myIsHost
        ? `onclick="hostEditCell('${p.id}','${key}')" style="cursor:pointer;" title="Нажмите чтобы изменить"`
        : '';
      const desc = (typeof ALL_DESCRIPTIONS !== 'undefined') ? ALL_DESCRIPTIONS[val] : null;
      const tipHtml = desc && DESCRIBED_TRAITS.includes(key)
        ? `<span class="has-tooltip" data-tip="${esc(desc)}">${esc(val)} <span class="tip-icon">ℹ</span></span>`
        : esc(val);
      return `<td class="revealed-cell ${myIsHost ? 'host-editable' : ''}" ${editAttr}>${tipHtml}</td>`;
    }).join('');

    return `<tr>
      <td>${esc(p.name)}${p.id === myId ? ' <span style="color:var(--accent);font-size:9px;">(вы)</span>' : ''}${!p.is_alive ? ' <span style="color:var(--danger);font-size:9px;">[исключён]</span>' : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  tableEl.innerHTML = header + rows;
  activateTooltips(tableEl);

  // Update host hint
  const hint = document.getElementById('table-hint-host');
  if (hint) hint.textContent = myIsHost ? '· нажмите на любую ячейку чтобы изменить' : '';
}

function renderOver() {
  const won = gameState.winner === 'survivors';
  const title = document.getElementById('over-title');
  title.textContent = won ? 'ВЫЖИЛИ' : 'ПОГИБЛИ';
  title.className = `game-over-title ${won ? 'win' : 'lose'}`;
  document.getElementById('over-sub').textContent = won
    ? 'Оставшиеся попали в бункер. Человечество продолжится.'
    : 'Бункер так и не был заполнен правильными людьми.';
  document.getElementById('over-players').innerHTML = gameState.players.map(p => `
    <div class="player-item ${p.is_alive ? 'alive' : 'dead'}">
      <span class="player-name">${esc(p.name)}</span>
      ${p.is_alive
        ? '<span class="player-badge" style="color:var(--green);">В бункере</span>'
        : '<span class="player-badge" style="color:var(--danger);">Исключён</span>'}
    </div>`).join('');
  document.getElementById('host-restart').style.display = myIsHost ? 'block' : 'none';
}

// ── Host: click cell in table to edit ─────────────────────────────────────
function hostEditCell(targetId, traitKey) {
  if (!myIsHost || !gameState) return;
  const player = gameState.players.find(p => p.id === targetId);
  if (!player) return;

  const card = player.card || player.revealed_card || {};
  const current = card[traitKey] || '—';
  const pools = gameState.trait_pools || {};
  const options = (pools[traitKey] && pools[traitKey].length > 0) ? pools[traitKey] : [current];
  const allOptions = options.includes(current) ? options : [current, ...options];

  // Build inline cell editor modal
  const label = TRAIT_NAMES[traitKey] || traitKey;
  document.getElementById('cell-edit-player').textContent = player.name;
  document.getElementById('cell-edit-trait').textContent = label;

  const sel = document.getElementById('cell-edit-select');
  sel.innerHTML = allOptions.map(v =>
    `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`
  ).join('');
  sel.dataset.targetId = targetId;
  sel.dataset.traitKey = traitKey;
  sel.dataset.allOptions = JSON.stringify(allOptions);

  document.getElementById('cell-edit-modal').style.display = 'flex';
}

function randomCellEdit() {
  const sel = document.getElementById('cell-edit-select');
  const allOptions = JSON.parse(sel.dataset.allOptions || '[]');
  if (allOptions.length < 2) return;
  const current = sel.value;
  const others = allOptions.filter(v => v !== current);
  sel.value = others[Math.floor(Math.random() * others.length)];
}

function closeCellEditModal() {
  document.getElementById('cell-edit-modal').style.display = 'none';
}
// ── Host: full edit modal (all traits of a player) ─────────────────────────
function openFullEditModal(targetId) {
  if (!myIsHost || !gameState) return;
  const player = gameState.players.find(p => p.id === targetId);
  if (!player) return;

  const card = player.card || {};
  const pools = gameState.trait_pools || {};

  document.getElementById('full-edit-player').textContent = player.name;

  const container = document.getElementById('full-edit-traits');
  container.innerHTML = Object.entries(TRAIT_NAMES).map(([key, label]) => {
    const current = card[key] || '—';
    const options = (pools[key] && pools[key].length > 0) ? pools[key] : [current];
    const allOptions = options.includes(current) ? options : [current, ...options];
    const opts = allOptions.map(v =>
      `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`
    ).join('');
    const isRevealed = (player.revealed_traits || []).includes(key);
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);">
        <div style="min-width:140px;">
          <div style="font-size:9px;letter-spacing:2px;color:var(--text-dim);text-transform:uppercase;">${label}</div>
          ${isRevealed ? '<div style="font-size:9px;color:var(--green);letter-spacing:1px;">раскрыто</div>' : ''}
        </div>
        <select data-target="${esc(targetId)}" data-key="${key}"
          onchange="doOverride(this.dataset.target, this.dataset.key, this.value)"
          style="flex:1;background:var(--bg);border:1px solid var(--border);color:var(--text-bright);
                 font-family:var(--mono);font-size:12px;padding:8px 10px;outline:none;cursor:pointer;">
          ${opts}
        </select>
      </div>`;
  }).join('');

  document.getElementById('full-edit-modal').style.display = 'flex';
}

function closeFullEditModal() {
  document.getElementById('full-edit-modal').style.display = 'none';
}

document.getElementById('full-edit-modal').addEventListener('click', function(e) {
  if (e.target === this) closeFullEditModal();
});



function submitCellEdit() {
  const sel = document.getElementById('cell-edit-select');
  const targetId = sel.dataset.targetId;
  const traitKey = sel.dataset.traitKey;
  const value = sel.value;
  send({ action: 'override_trait', target_id: targetId, trait: traitKey, value });
  closeCellEditModal();
}

document.getElementById('cell-edit-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCellEditModal();
});

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
  ensureWS(() => send({ action: 'join_room', room_id: code }));
}

function doAuth(mode) {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  if (!username) { notify('Введите логин', 'error'); return; }
  if (!password) { notify('Введите пароль', 'error'); return; }
  ensureWS(() => send({ action: mode === 'register' ? 'register' : 'login', username, password }));
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

// ── Guest modal ────────────────────────────────────────────────────────────
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
if (codeParam) document.getElementById('join-code').value = codeParam.toUpperCase();
updateAuthUI();

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const active = document.activeElement?.id || '';
    if (active === 'auth-username' || active === 'auth-password') doAuth('login');
    else if (active === 'guest-nick-input') submitGuestNick();
    else if (document.getElementById('create-form').style.display !== 'none') doCreate();
    else if (document.getElementById('join-form').style.display !== 'none') doJoin();
  }
  if (e.key === 'Escape') { closeCellEditModal(); closeGuestModal(); closeFullEditModal(); }
});
