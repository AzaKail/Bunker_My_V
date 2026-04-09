// ── Host edit modal ────────────────────────────────────────────────────────

function openEditModal(targetId, targetName) {
  if (!myIsHost || !gameState) return;
  const player = gameState.players.find(p => p.id === targetId);
  if (!player) return;

  // Card may be missing if host hasn't received it yet — use revealed_card as fallback
  const card = player.card || player.revealed_card || {};

  document.getElementById('edit-modal-name').textContent = targetName;
  document.getElementById('edit-modal').style.display = 'flex';

  const pools = gameState.trait_pools || {};

  const traitsHtml = Object.entries(TRAIT_NAMES).map(([key, label]) => {
    const current = card[key] || '—';
    const options = (pools[key] && pools[key].length > 0) ? pools[key] : [current];
    // Ensure current value is in list
    const allOptions = options.includes(current) ? options : [current, ...options];
    const opts = allOptions.map(v =>
      `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`
    ).join('');
    return `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="min-width:130px; font-size:9px; letter-spacing:2px; color:var(--text-dim); text-transform:uppercase;">${label}</div>
        <select onchange="doOverride('${targetId}', '${key}', this.value)"
          style="flex:1; background:var(--bg); border:1px solid var(--border); color:var(--text-bright);
                 font-family:var(--mono); font-size:12px; padding:8px 10px; outline:none; cursor:pointer;">
          ${opts}
        </select>
      </div>
    `;
  }).join('');

  document.getElementById('edit-modal-traits').innerHTML = traitsHtml;
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
}

document.getElementById('edit-modal').addEventListener('click', function(e) {
  if (e.target === this) closeEditModal();
});

function doOverride(targetId, trait, value) {
  send({ action: 'override_trait', target_id: targetId, trait, value });
}
