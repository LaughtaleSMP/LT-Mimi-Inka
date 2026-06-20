import { world } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { playerDB, muteDB } from "./db.js";
import { configManager } from "./config.js";

// ── Glyph page size: keeps dropdown small for low-end devices ──
const GLYPH_PAGE_SIZE = 32;
// ── Bulk manager chunk size (replaces old page size) ──
const BULK_PAGE_SIZE = 15; // kept for reference, chunk picker used instead
// ── Paginated player browser page size (max 20 to stay performant) ──
const PLAYER_PAGE_SIZE = 20;
// ── Max players per alpha-chunk dropdown (keeps UI snappy) ──
const CHUNK_DROPDOWN_SIZE = 25;

export class CommandGUI {
    static bulkSessions = new Map();

    static async showMainMenu(player) {
        const form = new ActionFormData()
            .title("§lMimi Inka§r Menu")
            .body("§eSelect an action below to manage player customizations and mutes.§r")
            .button("Manage Titles")
            .button("Manage Nametags")
            .button("Bulk Manager")
            .button("Manage Mutes")
            .button("View Player Info")
            .button("Show All Customizations")
            .button("Browse & Edit Player")
            .button("Browse All Players (Info)");

        const response = await form.show(player);
        if (response.canceled) return;

        switch (response.selection) {
            case 0:
                await this.showTitleManager(player);
                break;
            case 1:
                await this.showNametagManager(player);
                break;
            case 2:
                await this.showBulkTitleManager(player);
                break;
            case 3:
                await this.showMuteManager(player);
                break;
            case 4:
                await this.showPlayerInfo(player);
                break;
            case 5:
                await this.showAllCustomizations(player);
                break;
            case 6: {
                // Two-step chunk picker → edit sub-menu
                const picked = await this.pickPlayerByChunk(player, "Edit Player");
                if (picked) await this.showEditPlayerMenu(player, picked);
                break;
            }
            case 7: {
                // Two-step chunk picker → info display
                const picked = await this.pickPlayerByChunk(player, "View Player Info");
                if (picked) {
                    const data = playerDB.getAllCustomizationsFor(picked);
                    const chatTitle = data?.chat?.title || null;
                    const chatNametag = data?.chat?.nametag || null;
                    const ingameTitle = data?.ingame?.title || null;
                    const ingameNametag = data?.ingame?.nametag || null;
                    player.sendMessage([
                        `${configManager.get("chatPrefix")}§l§6=== Info for ${picked} ===§r`,
                        `§eChat Title: §f${chatTitle || "-"}`,
                        `§eChat Nametag: §f${chatNametag || "-"}`,
                        `§eIn-game Title: §f${ingameTitle ? (typeof ingameTitle === "object" ? ingameTitle.text : ingameTitle) : "-"} ${ingameTitle ? `(§a${typeof ingameTitle === "object" ? (ingameTitle.position ?? "top") : "top"}§f)` : ""}`,
                        `§eIn-game Nametag: §f${ingameNametag || "-"}`
                    ].join("\n"));
                }
                break;
            }
        }
    }

    /**
     * Sub-menu shown after picking a player via Browse & Edit.
     * Lets admin choose: edit title, edit nametag, or view info.
     */
    static async showEditPlayerMenu(admin, targetName) {
        const data = playerDB.getAllCustomizationsFor(targetName);
        const chatTitle = data?.chat?.title || "-";
        const chatNametag = data?.chat?.nametag || "-";
        const igTitle = data?.ingame?.title?.text || "-";
        const igNametag = data?.ingame?.nametag || "-";

        const form = new ActionFormData()
            .title(`§l§6Edit: ${targetName}§r`)
            .body(
                `§eCurrent Customizations:§r\n\n` +
                `  §eChat Title: §f${chatTitle}\n` +
                `  §eChat Nametag: §f${chatNametag}\n` +
                `  §eIG Title: §f${igTitle}\n` +
                `  §eIG Nametag: §f${igNametag}`
            )
            .button("Edit Title")
            .button("Edit Nametag")
            .button("Back");

        const res = await form.show(admin);
        if (res.canceled) return;
        if (res.selection === 2) {
            const picked = await this.pickPlayerByChunk(admin, "Edit Player");
            if (picked) await this.showEditPlayerMenu(admin, picked);
            return;
        }
        if (res.selection === 0) await this.showTitleManager(admin, targetName);
        if (res.selection === 1) await this.showNametagManager(admin, targetName);
    }

    static getPlayerOptions() {
        const onlinePlayers = [...world.getPlayers()]
            .map(p => p.name);

        const allPlayers = playerDB.getAllPlayers();

        const allOptions = [...new Set([...onlinePlayers, ...allPlayers])]
            .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

        return {
            onlinePlayers,
            allPlayers: allOptions
        };
    }

    /**
     * Group players by their first letter (A, B, C, ...).
     * Empty letters are skipped. Returns: [ { label: "A  (12)", players: [...] }, ... ]
     */
    static buildAlphaChunks(sortedPlayers) {
        if (!sortedPlayers || sortedPlayers.length === 0) return [];
        const map = new Map();
        for (const name of sortedPlayers) {
            const letter = (name[0] ?? "?").toUpperCase();
            if (!map.has(letter)) map.set(letter, []);
            map.get(letter).push(name);
        }
        return [...map.entries()].map(([letter, players]) => ({
            label: `${letter}  (${players.length})`,
            players
        }));
    }

    /**
     * Two-step ActionForm player picker:
     *   Step 1 — pick an alphabet chunk (e.g. "A – E  (25)")
     *   Step 2 — pick a player name within that chunk
     * Online players are highlighted green.
     * Returns selected player name or null.
     */
    static async pickPlayerByChunk(admin, titlePrefix = "Select Player") {
        const { allPlayers, onlinePlayers } = this.getPlayerOptions();
        if (allPlayers.length === 0) {
            admin.sendMessage(configManager.get("chatPrefix") + "§cNo known players found.");
            return null;
        }
        const onlineSet = new Set(onlinePlayers);
        const chunks = this.buildAlphaChunks(allPlayers);

        // ── Step 1: Pick chunk ──
        const chunkForm = new ActionFormData()
            .title(`§l${titlePrefix}§r — Pick Range`)
            .body(`§eInfo: §f${allPlayers.length.toLocaleString("id-ID")} §rplayers registered.\n\n§eSelect an alphabetical range:§r`);

        // Online players shortcut at top
        if (onlinePlayers.length > 0) {
            chunkForm.button(`§aOnline Now  (${onlinePlayers.length})`);
        }
        for (const chunk of chunks) {
            chunkForm.button(chunk.label);
        }
        chunkForm.button("Back");

        const chunkRes = await chunkForm.show(admin);
        if (chunkRes.canceled) return null;

        let candidates;
        const hasOnlineBtn = onlinePlayers.length > 0;
        const cancelIdx = hasOnlineBtn ? chunks.length + 1 : chunks.length;

        if (chunkRes.selection === cancelIdx) {
            if (titlePrefix === "Select Player") return null; // Generic fallback
            return this.showMainMenu(admin);
        }
        if (hasOnlineBtn && chunkRes.selection === 0) {
            candidates = [...onlinePlayers].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        } else {
            const chunkIdx = hasOnlineBtn ? chunkRes.selection - 1 : chunkRes.selection;
            candidates = chunks[chunkIdx].players;
        }

        // ── Step 2: Pick player from chunk ──
        const nameForm = new ActionFormData()
            .title(`§l${titlePrefix}§r — Pick Player`)
            .body(`§eInfo: §f${candidates.length.toLocaleString("id-ID")} §rplayers in this range.§r`);

        const btns = [];
        for (const name of candidates) {
            const isOnline = onlineSet.has(name);
            nameForm.button(isOnline ? `§a${name}\n(online)` : name);
            btns.push({ type: "player", name });
        }

        nameForm.button("« Back");
        btns.push({ type: "back" });

        const nameRes = await nameForm.show(admin);
        if (nameRes.canceled) return null;
        const sel = btns[nameRes.selection];
        if (!sel) return null;
        if (sel.type === "back") return this.pickPlayerByChunk(admin, titlePrefix);
        return sel.name;
    }

    /**
     * Adds exactly 2 fields to the form (predictable indices):
     *   [0] textField  — manual name input
     *   [1] dropdown   — online players (or "<No players online>" placeholder)
     * Returns snapshot for TOCTOU safety.
     * NOTE: For full player browse, use pickPlayerByChunk() BEFORE showing the form.
     */
    static showPlayerSelector(form, initialValue = "") {
        const snapshot = this.getPlayerOptions();

        // Field 0: manual text input
        form.textField("Player Name:", "Enter name (or pick below)", { defaultValue: initialValue });

        // Field 1: online players — always present so form value indices stay fixed.
        // Intentionally NOT including all 600+ known players here to avoid lag.
        const onlineOpts = snapshot.onlinePlayers.length > 0
            ? ["<Manual Entry>", ...snapshot.onlinePlayers]
            : ["<No players online>"];
        form.dropdown("Quick Pick — Online Players:", onlineOpts);

        return snapshot;
    }

    // [RC-1 FIX] Accept snapshot to avoid re-fetching player list (TOCTOU)
    // Reads exactly 2 values: [manualName, onlineIndex]
    static getSelectedPlayer(values, snapshot) {
        const [manualName, onlineIndex] = values;

        // First priority: manual text input
        if (manualName?.trim()) return manualName.trim();

        // Second priority: online player dropdown
        const { onlinePlayers } = snapshot;
        if (onlinePlayers.length > 0 && onlineIndex > 0 && onlinePlayers[onlineIndex - 1]) {
            return onlinePlayers[onlineIndex - 1];
        }

        return null;
    }

    // pickPlayerPaginated kept for legacy compatibility; prefer pickPlayerByChunk for new flows.
    static async pickPlayerPaginated(player, page = 0) {
        return this.pickPlayerByChunk(player, "Browse Players");
    }

    // ── Paginated Glyph Picker ──
    // Instead of dumping 256 glyphs into one dropdown, show a page selector first.
    static async pickGlyph(player) {
        const glyphs = configManager.get("glyphs");
        const totalPages = Math.ceil(glyphs.length / GLYPH_PAGE_SIZE);

        // Step 1: Pick page
        const pageLabels = [];
        for (let p = 0; p < totalPages; p++) {
            const start = (p * GLYPH_PAGE_SIZE).toString(16).padStart(2, '0').toUpperCase();
            const end = Math.min((p + 1) * GLYPH_PAGE_SIZE - 1, glyphs.length - 1)
                .toString(16).padStart(2, '0').toUpperCase();
            // Show a preview of first 4 glyphs on that page
            const preview = glyphs.slice(p * GLYPH_PAGE_SIZE, p * GLYPH_PAGE_SIZE + 4).join(' ');
            pageLabels.push(`${start}-${end}  ${preview}`);
        }

        const pageForm = new ActionFormData()
            .title("§lSelect Glyph Page§r")
            .body("§ePick a hex range to browse available glyphs:§r");
        for (const label of pageLabels) {
            pageForm.button(label);
        }
        pageForm.button("Back");

        const pageRes = await pageForm.show(player);
        if (pageRes.canceled || pageRes.selection === totalPages) return null;

        const pageIndex = pageRes.selection;

        // Step 2: Pick glyph from selected page
        const offset = pageIndex * GLYPH_PAGE_SIZE;
        const pageGlyphs = glyphs.slice(offset, offset + GLYPH_PAGE_SIZE);

        const glyphForm = new ActionFormData()
            .title(`Glyphs ${pageLabels[pageIndex].split('  ')[0]}`);

        for (let i = 0; i < pageGlyphs.length; i++) {
            const hex = (offset + i).toString(16).padStart(2, '0').toUpperCase();
            glyphForm.button(`${hex}  ${pageGlyphs[i]}`);
        }

        glyphForm.button("« Back");

        const glyphRes = await glyphForm.show(player);
        if (glyphRes.canceled) return null;
        if (glyphRes.selection === pageGlyphs.length) return this.pickGlyph(player);

        return glyphs[offset + glyphRes.selection];
    }


    static async showTitleManager(player, initialName = "") {
        const glyphs = configManager.get("glyphs");
        const hasGlyphs = glyphs && glyphs.length > 0;

        const form = new ModalFormData()
            .title(initialName ? `Title Manager — ${initialName}` : "Title Manager");

        // Add player selection options — capture snapshot for RC-1 safety
        const snapshot = this.showPlayerSelector(form, initialName);

        form.dropdown("Mode:", ["Chat", "In-game", "Both"]);

        if (hasGlyphs) {
            form.toggle("Use Glyph", { defaultValue: false });
            form.textField("Custom Text:", "Enter custom text (optional)");
        } else {
            form.textField("Title:", "Enter title (or leave empty to remove)");
        }

        if (hasGlyphs) {
            form.dropdown("Position:", ["Top", "Before", "After", "Below"]);
        }

        const response = await form.show(player);
        if (response.canceled) return this.showMainMenu(player);

        // Get selected player from the response values (using build-time snapshot)
        // showPlayerSelector always adds exactly 2 fields [text, online-dropdown]
        const targetName = this.getSelectedPlayer(response.formValues.slice(0, 2), snapshot);
        const [, , modeIndex, ...rest] = response.formValues;

        if (!targetName) {
            player.sendMessage(configManager.get("chatPrefix") + "§cPlease specify a player!");
            return;
        }

        const modes = this._resolveModes(modeIndex);

        let title, position;
        if (hasGlyphs) {
            const [useGlyph, customText, positionIndex] = rest;

            if (useGlyph) {
                // Open paginated glyph picker
                const picked = await this.pickGlyph(player);
                if (!picked) {
                    player.sendMessage(configManager.get("chatPrefix") + "§eGlyph selection cancelled.");
                    return;
                }
                title = picked;
            } else if (customText) {
                title = customText;
            } else {
                // No glyph, no text → remove
                for (const mode of modes) {
                    playerDB.removeCustomization(targetName, "title", mode);
                }
                player.sendMessage(configManager.get("chatPrefix") + `§aRemoved title for ${targetName} (${modes.join('+')})`);
                return;
            }

            position = ["top", "before", "after", "below"][positionIndex];
        } else {
            [title] = rest;
            position = "top";
        }

        if (title) {
            // Use batch for multi-mode writes
            const operations = [];
            for (const mode of modes) {
                const value = mode === "ingame" ? { text: title, position } : title;
                operations.push({ player: targetName, type: "title", value, mode });
            }
            playerDB.batchSetCustomizations(operations);

            const modeLabel = modes.join('+');
            player.sendMessage(configManager.get("chatPrefix") + `§aSet ${modeLabel} title for ${targetName} to: ${title}${modes.includes("ingame") ? ` (${position})` : ''}`);
        } else {
            for (const mode of modes) {
                playerDB.removeCustomization(targetName, "title", mode);
            }
            player.sendMessage(configManager.get("chatPrefix") + `§aRemoved title for ${targetName} (${modes.join('+')})`);
        }

        // Refresh in-game display if ingame mode was touched
        if (modes.includes("ingame")) {
            const targetPlayer = [...world.getPlayers()].find(p => p.name === targetName);
            if (targetPlayer) playerDB.refreshPlayerNameTag(targetPlayer);
        }
    }



    static async showNametagManager(player, initialName = "") {
        const glyphs = configManager.get("glyphs");
        const hasGlyphs = glyphs && glyphs.length > 0;

        const form = new ModalFormData()
            .title(initialName ? `Nametag Manager — ${initialName}` : "Nametag Manager");

        // Add player selection options — capture snapshot for RC-1 safety
        const snapshot = this.showPlayerSelector(form, initialName);

        form.dropdown("Mode:", ["Chat", "In-game", "Both"]);

        if (hasGlyphs) {
            form.toggle("Use Glyph", { defaultValue: false });
            form.textField("Custom Text:", "Enter custom text (optional)");
        } else {
            form.textField("Nametag:", "Enter nametag (or leave empty to remove)");
        }

        const response = await form.show(player);
        if (response.canceled) return this.showMainMenu(player);

        // Get selected player from the response values (using build-time snapshot)
        // showPlayerSelector always adds exactly 2 fields [text, online-dropdown]
        const targetName = this.getSelectedPlayer(response.formValues.slice(0, 2), snapshot);
        const [, , modeIndex, ...rest] = response.formValues;

        if (!targetName) {
            player.sendMessage(configManager.get("chatPrefix") + "§cPlease specify a player!");
            return;
        }

        const modes = this._resolveModes(modeIndex);

        let nametag;
        if (hasGlyphs) {
            const [useGlyph, customText] = rest;

            if (useGlyph) {
                // Open paginated glyph picker
                const picked = await this.pickGlyph(player);
                if (!picked) {
                    player.sendMessage(configManager.get("chatPrefix") + "§eGlyph selection cancelled.");
                    return;
                }
                nametag = picked;
            } else if (customText) {
                nametag = customText;
            } else {
                for (const mode of modes) {
                    playerDB.removeCustomization(targetName, "nametag", mode);
                }
                player.sendMessage(configManager.get("chatPrefix") + `§aRemoved nametag for ${targetName} (${modes.join('+')})`);
                return;
            }
        } else {
            [nametag] = rest;
        }

        if (nametag) {
            const operations = [];
            for (const mode of modes) {
                operations.push({ player: targetName, type: "nametag", value: nametag, mode });
            }
            playerDB.batchSetCustomizations(operations);
            player.sendMessage(configManager.get("chatPrefix") + `§aSet ${modes.join('+')} nametag for ${targetName} to: ${nametag}`);
        } else {
            for (const mode of modes) {
                playerDB.removeCustomization(targetName, "nametag", mode);
            }
            player.sendMessage(configManager.get("chatPrefix") + `§aRemoved nametag for ${targetName} (${modes.join('+')})`);
        }

        // Refresh in-game display if ingame mode was touched
        if (modes.includes("ingame")) {
            const targetPlayer = [...world.getPlayers()].find(p => p.name === targetName);
            if (targetPlayer) playerDB.refreshPlayerNameTag(targetPlayer);
        }
    }



    /**
     * Bulk manager — Cross-Chunk Shopping Cart Pattern.
     * Allows selecting multiple players from different alphabet chunks into a temporary session.
     */
    static async showBulkTitleManager(player) {
        if (!this.bulkSessions.has(player.name)) {
            this.bulkSessions.set(player.name, new Set());
        }
        const session = this.bulkSessions.get(player.name);
        const { onlinePlayers, allPlayers } = this.getPlayerOptions();

        if (allPlayers.length === 0) {
            player.sendMessage(configManager.get("chatPrefix") + "§cNo known players found!");
            return;
        }

        const chunks = this.buildAlphaChunks(allPlayers);

        const sessionNames = Array.from(session);
        const cartBody = session.size === 0
            ? "§eNo players selected yet.\n§rPick a group below to start adding targets."
            : `§eShopping Cart — ${session.size.toLocaleString("id-ID")} player(s) selected:\n§r${sessionNames.map(n => `  §a• §f${n}`).join("\n")}\n\n§eAdd more or proceed below:§r`;

        const form = new ActionFormData()
            .title("§lBulk Manager§r — Dashboard")
            .body(cartBody);

        const hasOnline = onlinePlayers.length > 0;

        if (session.size > 0) {
            form.button("Proceed to Customization");
            form.button("Clear Selection");
        }

        form.button("Global (All Players)");
        if (hasOnline) form.button(`§aOnline Now  (${onlinePlayers.length})`);
        for (const chunk of chunks) form.button(chunk.label);
        form.button("Back");

        const res = await form.show(player);
        if (res.canceled) return;

        const selection = res.selection;
        let currentIndex = 0;

        if (session.size > 0) {
            if (selection === currentIndex++) {
                // Proceed
                await this._showBulkForm(player, Array.from(session), onlinePlayers, false);
                return;
            }
            if (selection === currentIndex++) {
                // Clear
                session.clear();
                return this.showBulkTitleManager(player);
            }
        }

        if (selection === currentIndex++) {
            // Global (All Players)
            await this._showBulkForm(player, allPlayers, onlinePlayers, true);
            return;
        }

        if (hasOnline) {
            if (selection === currentIndex++) {
                // Online Now
                await this._showBulkChunkSelection(player, [...onlinePlayers].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())), onlinePlayers);
                return;
            }
        }

        // Chunks
        for (const chunk of chunks) {
            if (selection === currentIndex++) {
                await this._showBulkChunkSelection(player, chunk.players, onlinePlayers);
                return;
            }
        }

        // Back
        if (selection === currentIndex) return this.showMainMenu(player);
    }

    static async _showBulkChunkSelection(player, chunkPlayers, onlinePlayers) {
        const session = this.bulkSessions.get(player.name);
        const form = new ModalFormData()
            .title(`Select Targets (${chunkPlayers.length} Players)`);

        form.toggle("Select ALL in this group", { defaultValue: false });
        for (const name of chunkPlayers) {
            const isOnline = onlinePlayers.includes(name);
            const isChecked = session.has(name);
            form.toggle(isOnline ? `§a${name} (online)` : name, { defaultValue: isChecked });
        }

        const res = await form.show(player);
        if (res.canceled) return this.showBulkTitleManager(player);

        const selectAll = res.formValues[0];
        const toggles = res.formValues.slice(1);

        for (let i = 0; i < chunkPlayers.length; i++) {
            const name = chunkPlayers[i];
            if (selectAll || toggles[i]) {
                session.add(name);
            } else {
                session.delete(name);
            }
        }

        return this.showBulkTitleManager(player);
    }

    /** Inner bulk form — no toggles unless Global! */
    static async _showBulkForm(player, selectedPlayers, onlinePlayers, isGlobal = false) {
        const glyphs = configManager.get("glyphs");
        const hasGlyphs = glyphs && glyphs.length > 0;

        const form = new ModalFormData()
            .title(isGlobal ? `Bulk Manager — GLOBAL` : `Apply to ${selectedPlayers.length} Players`);

        if (isGlobal) {
            form.toggle(`Confirm apply to ALL ${selectedPlayers.length} registered players?`, { defaultValue: false });
        }

        form.dropdown("Type:", ["Title", "Nametag"]);
        form.dropdown("Mode:", ["Both (Chat+Ingame)", "Chat Only", "In-game Only"]);
        // Position hanya berlaku untuk Title + ingame, selalu tampil agar indeks form stabil
        form.dropdown("Position (Title only):", ["Top", "Before", "After", "Below"]);

        if (hasGlyphs) {
            form.toggle("Use Glyph", { defaultValue: false });
            form.textField("Custom Text:", "Enter value (if not using glyph)");
        } else {
            form.textField("Value:", "Enter title/nametag value");
        }

        const response = await form.show(player);
        if (response.canceled) return this.showBulkTitleManager(player);

        let restStart = 0;
        let finalPlayers = selectedPlayers;

        if (isGlobal) {
            const confirmGlobal = response.formValues[0];
            if (!confirmGlobal) {
                player.sendMessage(configManager.get("chatPrefix") + "§cGlobal bulk edit cancelled (checkbox not checked).");
                return;
            }
            restStart = 1;
        }

        if (finalPlayers.length === 0) {
            player.sendMessage(configManager.get("chatPrefix") + "§cNo players selected!");
            return;
        }

        const restValues = response.formValues.slice(restStart);

        // Parse type, mode, position, value
        const [typeIndex, modeIndex, positionIndex, ...valueRest] = restValues;
        const type = typeIndex === 0 ? "title" : "nametag";
        const modes = modeIndex === 0 ? ["chat", "ingame"] : modeIndex === 1 ? ["chat"] : ["ingame"];
        const position = ["top", "before", "after", "below"][positionIndex] ?? "top";

        let value;
        if (hasGlyphs) {
            const [useGlyph, customText] = valueRest;
            if (useGlyph) {
                const picked = await this.pickGlyph(player);
                if (!picked) {
                    player.sendMessage(configManager.get("chatPrefix") + "§eGlyph selection cancelled.");
                    return;
                }
                value = picked;
            } else if (customText) {
                value = customText;
            } else {
                player.sendMessage(configManager.get("chatPrefix") + "§cPlease specify a value!");
                return;
            }
        } else {
            value = valueRest[0];
            if (!value) {
                player.sendMessage(configManager.get("chatPrefix") + "§cPlease specify a value!");
                return;
            }
        }

        // Build batch operations — single DB write, works for offline players too
        const operations = [];
        for (const name of finalPlayers) {
            for (const mode of modes) {
                const finalValue = (mode === "ingame" && type === "title")
                    ? { text: value, position }
                    : value;
                operations.push({ player: name, type, value: finalValue, mode });
            }
        }

        playerDB.batchSetCustomizations(operations);

        // Refresh visuals untuk yang sedang online saja
        if (modes.includes("ingame")) {
            const allOnline = [...world.getPlayers()];
            for (const name of finalPlayers) {
                const target = allOnline.find(p => p.name === name);
                if (target) playerDB.refreshPlayerNameTag(target);
            }
        }

        const posLabel = type === "title" && modes.includes("ingame") ? ` [${position}]` : "";
        player.sendMessage(configManager.get("chatPrefix") + `§aSet ${type}${posLabel} for §e${finalPlayers.length}§a players (${modes.join('+')}): ${value}`);

        // Clear the shopping cart session
        this.bulkSessions.delete(player.name);
    }



    static async showMuteManager(player) {
        const muteSettings = muteDB.get("muteSettings", {});
        const playerSettings = muteSettings[player.name] || {};

        let body = "";
        if (playerSettings.muteAll) {
            const exceptions = playerSettings.exceptions || [];
            body = "Mute Status: All players muted\n\nExceptions:\n" +
                (exceptions.length > 0
                    ? exceptions.map(p => `- ${p}`).join("\n")
                    : "None");
        } else {
            const muted = playerSettings.muted || [];
            body = "Muted players:\n" +
                (muted.length > 0
                    ? muted.map(p => `- ${p}`).join("\n")
                    : "None");
        }

        const form = new ActionFormData()
            .title("Mute Manager")
            .body(body)
            .button(playerSettings.muteAll ? "Disable Mute All" : "Enable Mute All")
            .button(playerSettings.muteAll ? "Add Exception" : "Mute Player")
            .button("Back");

        const response = await form.show(player);
        if (response.canceled) return;

        switch (response.selection) {
            case 0:
                // Toggle mute all
                playerSettings.muteAll = !playerSettings.muteAll;
                if (playerSettings.muteAll) {
                    playerSettings.exceptions = [];
                }
                muteSettings[player.name] = playerSettings;
                muteDB.set("muteSettings", muteSettings);
                player.sendMessage(configManager.get("chatPrefix") + (playerSettings.muteAll
                    ? "§aAll players will now be muted (except those you unmute)"
                    : "§aAll players will now be unmuted (except those you mute)"
                ));
                await this.showMuteManager(player);
                break;
            case 1:
                // Show add exception/mute player form
                await this.showMuteNewPlayer(player);
                break;
            case 2:
                await this.showMainMenu(player);
                break;
        }
    }

    static async showMuteNewPlayer(player) {
        const form = new ModalFormData()
            .title("Mute Player")
            .textField("Player Name:", "Enter player name");

        const response = await form.show(player);
        if (response.canceled) {
            await this.showMuteManager(player);
            return;
        }

        const [targetName] = response.formValues;
        if (!targetName) {
            player.sendMessage(configManager.get("chatPrefix") + "§cPlease enter a player name!");
            await this.showMuteManager(player);
            return;
        }

        let muteSettings = muteDB.get("muteSettings", {});
        muteSettings[player.name] = muteSettings[player.name] || {};

        if (muteSettings[player.name].muteAll) {
            muteSettings[player.name].exceptions = muteSettings[player.name].exceptions || [];
            muteSettings[player.name].exceptions.push(targetName);
            player.sendMessage(configManager.get("chatPrefix") + `§aAdded ${targetName} to mute exceptions`);
        } else {
            muteSettings[player.name].muted = muteSettings[player.name].muted || [];
            muteSettings[player.name].muted.push(targetName);
            player.sendMessage(configManager.get("chatPrefix") + `§aMuted player: ${targetName}`);
        }

        muteDB.set("muteSettings", muteSettings);
        await this.showMuteManager(player);
    }



    static async showPlayerInfo(player) {
        const form = new ModalFormData()
            .title("Player Info");

        // Add player selection options — capture snapshot for RC-1 safety
        const snapshot = this.showPlayerSelector(form);

        const response = await form.show(player);
        if (response.canceled) return this.showMainMenu(player);

        // Get selected player from the response values (using build-time snapshot)
        // showPlayerSelector always adds exactly 2 fields [text, online-dropdown]
        const targetName = this.getSelectedPlayer(response.formValues.slice(0, 2), snapshot);

        if (!targetName) {
            player.sendMessage(configManager.get("chatPrefix") + "§cPlease specify a player!");
            return;
        }

        // Single cached read for all 4 slots
        const data = playerDB.getAllCustomizationsFor(targetName);
        const chatTitle = data?.chat?.title || null;
        const chatNametag = data?.chat?.nametag || null;
        const ingameTitle = data?.ingame?.title || null;
        const ingameNametag = data?.ingame?.nametag || null;

        player.sendMessage([
            `${configManager.get("chatPrefix")}§l§6=== Info for ${targetName} ===§r`,
            `§eChat Title: §f${chatTitle || "-"}`,
            `§eChat Nametag: §f${chatNametag || "-"}`,
            `§eIn-game Title: §f${ingameTitle ? (typeof ingameTitle === "object" ? ingameTitle.text : ingameTitle) : "-"} ${ingameTitle ? `(§a${typeof ingameTitle === "object" ? (ingameTitle.position ?? "top") : "top"}§f)` : ""}`,
            `§eIn-game Nametag: §f${ingameNametag || "-"}`
        ].join("\n"));
    }

    static async showAllCustomizations(player) {
        const allPlayers = playerDB.getAllPlayers();

        // Single read of the entire customizations object (cached)
        const allCust = playerDB._getCustCached();
        let customizationList = [];

        for (const playerName of allPlayers) {
            const pData = allCust[playerName] || {};
            const chatTitle = pData?.chat?.title || null;
            const chatNametag = pData?.chat?.nametag || null;
            const ingameTitle = pData?.ingame?.title || null;
            const ingameNametag = pData?.ingame?.nametag || null;

            // Skip players with zero customizations
            if (!chatTitle && !chatNametag && !ingameTitle && !ingameNametag) continue;

            let details = `§l§6${playerName}:§r\n`;
            if (chatTitle) details += `  §eChat Title: §b${chatTitle}§r\n`;
            if (chatNametag) details += `  §eChat Nametag: §b${chatNametag}§r\n`;
            if (ingameTitle) details += `  §eIn-game Title: §a${typeof ingameTitle === "object" ? ingameTitle.text : ingameTitle} (§f${typeof ingameTitle === "object" ? (ingameTitle.position ?? "top") : "top"}§a)§r\n`;
            if (ingameNametag) details += `  §eIn-game Nametag: §a${ingameNametag}§r\n`;

            customizationList.push(details);
        }

        if (customizationList.length === 0) {
            customizationList.push("No customizations found for any player.");
        }

        await this.displayCustomizationsInGUI(customizationList, player);
    }

    static async displayCustomizationsInGUI(customizationList, player, page = 0) {
        // Max 20 entries per page to avoid body overflow on low-end devices
        const PAGE_SIZE = 20;
        const totalPages = Math.ceil(customizationList.length / PAGE_SIZE);
        const offset = page * PAGE_SIZE;
        const pageEntries = customizationList.slice(offset, offset + PAGE_SIZE);

        const formattedBody = pageEntries.join("\n");

        const form = new ActionFormData()
            .title(`§eAll Customizations (${page + 1}/${totalPages || 1})`)
            .body(formattedBody);

        const btns = [];
        if (totalPages > 1) {
            const prevPage = (page - 1 + totalPages) % totalPages;
            const nextPage = (page + 1) % totalPages;
            form.button(`« Prev (${prevPage + 1}/${totalPages})`);
            btns.push({ type: "prev", page: prevPage });
            form.button(`Next (${nextPage + 1}/${totalPages}) »`);
            btns.push({ type: "next", page: nextPage });
        }
        form.button("Back");
        btns.push({ type: "back" });

        const res = await form.show(player);
        if (res.canceled) return;
        const sel = btns[res.selection];
        if (!sel) return;
        if (sel.type === "back") return this.showMainMenu(player);
        // Navigate pages
        await this.displayCustomizationsInGUI(customizationList, player, sel.page);
    }



    // 0=chat, 1=ingame, 2=both
    static _resolveModes(modeIndex) {
        switch (modeIndex) {
            case 0: return ["chat"];
            case 1: return ["ingame"];
            case 2: return ["chat", "ingame"];
            default: return ["chat"];
        }
    }
}