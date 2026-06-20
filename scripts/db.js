import { world } from "@minecraft/server";

// Single source of truth for nametag+title composition (used by commands, GUI, spawn)
export function composeNameTag(displayName, title) {
    if (!title) return displayName;
    const text = typeof title === "string" ? title : title.text;
    const position = typeof title === "string" ? "top" : (title.position || "top");
    if (!text) return displayName;

    switch (position) {
        case "top":    return `${text}\n${displayName}`;
        case "before": return `${text} ${displayName}`;
        case "after":  return `${displayName} ${text}`;
        case "below":  return `${displayName}\n${text}`;
        default:       return `${text}\n${displayName}`;
    }
}

class Database {
  constructor(name) {
    this.name = name;
    this.CHUNK_SIZE = 28000;
  }

  _chunkKey(key, chunkIndex) {
    return `${this.name}:${key}:c${chunkIndex}`;
  }

  set(key, value) {
    try {
      const jsonStr = JSON.stringify(value);

      // Always clear old single + chunks first, to avoid stale reads
      world.setDynamicProperty(this._getKey(key), undefined);
      this._clearChunks(key);

      if (jsonStr.length <= this.CHUNK_SIZE) {
        // Single chunk
        world.setDynamicProperty(this._getKey(key), jsonStr);
      } else {
        // Chunked
        const chunks = this._splitIntoChunks(jsonStr);
        // c0 = chunk count
        world.setDynamicProperty(this._chunkKey(key, 0), chunks.length.toString());
        chunks.forEach((chunk, i) => {
          world.setDynamicProperty(this._chunkKey(key, i + 1), chunk);
        });
      }
    } catch (e) {
      console.warn(`Failed to set ${this._getKey(key)}:`, e);
    }
  }

  get(key, defaultValue = null) {
    // Prefer chunked if present (new format)
    const chunkCountStr = world.getDynamicProperty(this._chunkKey(key, 0));
    if (chunkCountStr !== undefined) {
      try {
        const chunkCount = parseInt(chunkCountStr);
        let fullStr = "";
        for (let i = 1; i <= chunkCount; i++) {
          const chunk = world.getDynamicProperty(this._chunkKey(key, i));
          if (chunk === undefined) break;
          fullStr += chunk;
        }
        return JSON.parse(fullStr);
      } catch (e) {
        console.warn(`Failed to read chunks for ${key}:`, e);
        // If chunked fails, fall through to single as a backup
      }
    }

    // Fallback: single property (old or small data)
    const single = world.getDynamicProperty(this._getKey(key));
    if (single === undefined) return defaultValue;
    try {
      return JSON.parse(single);
    } catch {
      return single;
    }
  }

  has(key) {
    return (
      world.getDynamicProperty(this._chunkKey(key, 0)) !== undefined ||
      world.getDynamicProperty(this._getKey(key)) !== undefined
    );
  }

  delete(key) {
    if (!this.has(key)) return;
    world.setDynamicProperty(this._getKey(key), undefined);
    this._clearChunks(key);
  }

  _splitIntoChunks(str) {
    const chunks = [];
    for (let i = 0; i < str.length; i += this.CHUNK_SIZE) {
      chunks.push(str.slice(i, i + this.CHUNK_SIZE));
    }
    return chunks;
  }

  _clearChunks(key) {
    // c0 is meta, c1..cn are data; clear both
    for (let i = 0; i <= 100; i++) {
      world.setDynamicProperty(this._chunkKey(key, i), undefined);
    }
  }

  _getKey(key) {
    return `${this.name}:${key}`;
  }
}

// Database for player customizations and logs
class PlayerCustomizationDB extends Database {
    constructor() {
        super("player");
        /** @type {object|null} In-memory cache for customizations */
        this._custCache = null;
        /** @type {object|null} In-memory cache for player logs */
        this._logCache = null;
    }

    // ── Cache-aware set override ──
    // When ANY caller (bridge.js, plugins.js, etc.) writes through playerDB.set(),
    // the cache for that key must be invalidated so the next read reflects disk.
    set(key, value) {
        super.set(key, value);
        if (key === "customizations") {
            // If the caller passed the same object we had cached, keep it;
            // otherwise invalidate so next read pulls fresh from disk.
            this._custCache = value;
        } else if (key === "playerLogs") {
            this._logCache = value;
        }
    }

    // ── Cache helpers ──
    // Load customizations once, reuse until invalidated
    _getCustCached() {
        if (this._custCache === null) {
            this._custCache = this.get("customizations", {});
        }
        return this._custCache;
    }

    _getLogCached() {
        if (this._logCache === null) {
            this._logCache = this.get("playerLogs", {});
        }
        return this._logCache;
    }

    _invalidateCust() {
        this._custCache = null;
    }
    _invalidateLog() {
        this._logCache = null;
    }

    getCustomization(player, type, mode) {
        const customizations = this._getCustCached();
        return customizations[player]?.[mode]?.[type] ?? null;
    }

    /**
     * Get ALL customizations for a player in one call (avoids 4x DB reads).
     * Returns { chat: { title, nametag }, ingame: { title, nametag } }
     */
    getAllCustomizationsFor(player) {
        const customizations = this._getCustCached();
        return customizations[player] || {};
    }

    setCustomization(player, type, value, mode) {
        const customizations = this._getCustCached();
        if (!customizations[player]) customizations[player] = {};
        if (!customizations[player][mode]) customizations[player][mode] = {};
        customizations[player][mode][type] = value;
        this.set("customizations", customizations);
        // cache stays valid — we mutated it in-place
    }

    removeCustomization(player, type, mode) {
        const customizations = this._getCustCached();
        if (customizations[player]?.[mode]?.[type] !== undefined) {
            delete customizations[player][mode][type];
            this.set("customizations", customizations);
        }
    }

    // Track player logins
    logPlayerJoin(player) {
        const playerLogs = this._getLogCached();
        if (!playerLogs[player.name]) {
            playerLogs[player.name] = {
                firstJoin: Date.now(),
                lastJoin: Date.now(),
                joinCount: 1
            };
        } else {
            playerLogs[player.name].lastJoin = Date.now();
            playerLogs[player.name].joinCount++;
        }
        this.set("playerLogs", playerLogs);
        // cache stays valid
    }

    // Get all known players sorted by last join
    getAllPlayers() {
        const playerLogs = this._getLogCached();
        return Object.entries(playerLogs)
            .sort(([, a], [, b]) => b.lastJoin - a.lastJoin)
            .map(([name]) => name);
    }

    getPlayerInfo(name) {
        const playerLogs = this._getLogCached();
        return playerLogs[name] || null;
    }

    // Get all player join logs (used by admin playerinfo command for pagination)
    getAllPlayerLogs() {
        return this._getLogCached();
    }


    refreshPlayerNameTag(player) {
        const name = player.name;
        const title = this.getCustomization(name, "title", "ingame");
        const nametag = this.getCustomization(name, "nametag", "ingame") || name;
        player.nameTag = composeNameTag(nametag, title);
    }


    batchSetCustomizations(operations) {
        const customizations = this._getCustCached();
        for (const op of operations) {
            if (!customizations[op.player]) customizations[op.player] = {};
            if (!customizations[op.player][op.mode]) customizations[op.player][op.mode] = {};
            customizations[op.player][op.mode][op.type] = op.value;
        }
        this.set("customizations", customizations);
        // cache stays valid
    }
}

// Database for mutes
export const muteDB = new Database("mute");

// Database for player customizations and logs
export const playerDB = new PlayerCustomizationDB();