// Cross-pack backup bridge — responds to LT-Economy backup requests
// AND admin command dispatch (revoke/assign title/nametag).
// SLO: reply within 1 tick. Graceful skip if DB empty.
// §8.5: DP scoped per-pack → scriptevent as bridge
// §7.4: all failures reply with mimi:cmd_fail (never silent)

import { world, system } from "@minecraft/server";
import { playerDB } from "./db.js";

// ── Helpers ──────────────────────────────────────────────────────────
function extractValue(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.text) return v.text;
  return null;
}

// Slot → DB path mapping
const SLOT_PATH = {
  ct: { mode: "chat",   field: "title"   },
  cn: { mode: "chat",   field: "nametag" },
  it: { mode: "ingame", field: "title"   },
  in: { mode: "ingame", field: "nametag" },
};

// Reply helper for admin commands
function _cmdReply(id, ok, msg) {
  const eventId = ok ? "mimi:cmd_done" : "mimi:cmd_fail";
  const payload = JSON.stringify({ id, msg: msg || "" });
  system.run(() => {
    try {
      world.getDimension("overworld").runCommand(`scriptevent ${eventId} ${payload}`);
    } catch (e) {
      console.warn(`[Mimi-Bridge] cmd_reply failed: ${e.message}`);
    }
  });
}

// ── Scriptevent listener ─────────────────────────────────────────────
system.afterEvents.scriptEventReceive.subscribe((event) => {

  // ── 1. Backup request ────────────────────────────────────────────
  if (event.id === "mimi:backup_request") {
    try {
      const raw = playerDB._getCustCached();
      const playerCount = raw ? Object.keys(raw).length : 0;

      if (!raw || !playerCount) return; // nothing to send

      const out = {};
      for (const [name, modes] of Object.entries(raw)) {
        const entry = {};
        const ct  = extractValue(modes?.chat?.title);
        const cn  = extractValue(modes?.chat?.nametag);
        const it  = extractValue(modes?.ingame?.title);
        const inn = extractValue(modes?.ingame?.nametag);
        if (ct)  entry.ct = ct;
        if (cn)  entry.cn = cn;
        if (it)  entry.it = it;
        if (inn) entry.in = inn;
        if (Object.keys(entry).length) out[name] = entry;
      }

      if (!Object.keys(out).length) return; // no usable customizations

      const payload = JSON.stringify(out);

      system.run(() => {
        try {
          if (payload.length <= 1800) {
            world.getDimension("overworld").runCommand(
              `scriptevent mimi:backup_reply ${payload}`
            );
          } else {
            const CHUNK_SIZE = 1800;
            const chunks = [];
            for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
              chunks.push(payload.slice(i, i + CHUNK_SIZE));
            }
            const total = chunks.length;
            world.getDimension("overworld").runCommand(
              `scriptevent mimi:backup_start ${total}`
            );
            for (let i = 0; i < chunks.length; i++) {
              const idx = i;
              system.runTimeout(() => {
                try {
                  world.getDimension("overworld").runCommand(
                    `scriptevent mimi:backup_chunk ${idx}|${chunks[idx]}`
                  );
                } catch (e) {
                  console.warn(`[Mimi-Bridge] chunk ${idx} failed: ${e.message}`);
                }
              }, i + 1);
            }
          }
        } catch (e) {
          console.warn(`[Mimi-Bridge] reply failed: ${e.message}`);
        }
      });
    } catch (e) {
      console.warn(`[Mimi-Bridge] backup_request error: ${e.message}`);
    }
    return;
  }

  // ── 2. Admin Command ─────────────────────────────────────────────
  if (event.id === "mimi:admin_cmd") {
    let parsed;
    try {
      parsed = JSON.parse(event.message);
    } catch (e) {
      console.warn(`[Mimi-Bridge] admin_cmd parse failed: ${e.message}`);
      return;
    }

    const { id, player, action, slot, value } = parsed;

    if (!id || !player || !action || !slot) {
      _cmdReply(id, false, "Missing required fields in admin_cmd payload");
      return;
    }
    if (!SLOT_PATH[slot]) {
      _cmdReply(id, false, `Invalid slot: "${slot}"`);
      return;
    }

    try {
      const db   = playerDB._getCustCached();
      const path = SLOT_PATH[slot];

      if (action === "revoke_title" || action === "revoke_nametag") {
        const pData = db[player];
        if (!pData || !pData[path.mode] || !pData[path.mode][path.field]) {
          _cmdReply(id, true, `Nothing to revoke for "${player}" slot "${slot}" (already empty)`);
          return;
        }
        delete db[player][path.mode][path.field];
        if (Object.keys(db[player][path.mode]).length === 0) delete db[player][path.mode];
        if (Object.keys(db[player]).length === 0) delete db[player];
        playerDB.set("customizations", db);

        const onlineP = world.getPlayers().find(p => p.name === player);
        if (onlineP) {
          try { onlineP.sendMessage(`§e[Admin] §fKustomisasi §c${slot.toUpperCase()}§f kamu direvoke oleh Admin.`); } catch {}
        }
        _cmdReply(id, true, `Revoked slot "${slot}" for "${player}"`);

      } else if (action === "assign_title" || action === "assign_nametag") {
        if (!value) {
          _cmdReply(id, false, "Assign action requires a non-empty value");
          return;
        }
        if (!db[player]) db[player] = {};
        if (!db[player][path.mode]) db[player][path.mode] = {};
        db[player][path.mode][path.field] = value;
        playerDB.set("customizations", db);

        const onlineP = world.getPlayers().find(p => p.name === player);
        if (onlineP) {
          try { onlineP.sendMessage(`§a[Admin] §fKustomisasi §b${slot.toUpperCase()}§f kamu diperbarui oleh Admin.`); } catch {}
        }
        _cmdReply(id, true, `Assigned slot "${slot}" for "${player}"`);

      } else {
        _cmdReply(id, false, `Unknown action: "${action}"`);
      }

    } catch (e) {
      _cmdReply(id, false, `Handler error: ${e.message}`);
      console.warn(`[Mimi-Bridge] admin_cmd error: ${e.message}`);
    }
    return;
  }
});
