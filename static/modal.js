// ── Host override via cell click (used in app.js hostEditCell) ─────────────
// All logic is in app.js; this file kept for future modal extensions.

function doOverride(targetId, trait, value) {
  send({ action: 'override_trait', target_id: targetId, trait, value });
}
