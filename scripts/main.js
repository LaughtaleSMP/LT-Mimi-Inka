// Startup covered by LT-Economy unified banner

import { world, system } from "@minecraft/server";
import { playerDB, muteDB } from "./db.js";
import { configManager } from "./config.js";
import { commandManager } from "./commands.js";

// Import admin commands - this is important to register them!
import "./admin.js";
import "./plugins.js";
import "./bridge.js";

// Initialize config
configManager.initializeConfig();

// ☆ Chat Listener ☆
world.beforeEvents.chatSend.subscribe(event => {
    const sender = event.sender;
    const msg = event.message;

    //console.warn(`[CHAT] <${sender.name}> ${msg}`)
    // 🎯 FIRE SCRIPTEVENT FOR MONITOR
    system.run(() => {
        sender.runCommand(`scriptevent chat:message ${JSON.stringify({
            player_name: sender.name,
            message: msg
        })}`);
    })
    // ☆ Check for command prefix FIRST! ☆
    const prefixes = configManager.get("prefixes");
    const prefix = prefixes.find(p => msg.startsWith(p));
    if (prefix) {
        event.cancel = true;
        const fullCmd = msg.slice(prefix.length);
        const [cmd, ...args] = fullCmd.split(" ");

        // Try to execute the command
        const handled = commandManager.execute(sender, cmd, args);
        if (!handled) {
            sender.sendMessage(configManager.get("chatPrefix") + "§cUnknown command! Type !help for available commands");
        }
        return;
    }

    // ☆ Check if global mute is active ☆
    const isGlobalMute = configManager.get("globalMute");
    if (isGlobalMute) {
        event.cancel = true;
        sender.sendMessage(configManager.get("chatPrefix") + "§cGlobal mute is active! Chat is disabled.");
        return;
    }

    // ☆ Format and send chat message ☆
    event.cancel = true; // Cancel vanilla message
    const title = getTitle(sender.name);
    const nameTag = getNameTag(sender.name);
    const displayName = nameTag || sender.name;

    // Cache DB reads ONCE before the loop (not per-player)
    const muteSettings = muteDB.get("muteSettings", {});
    const showAlias = playerDB.get("showAlias", {});
    const hasCustomNametag = playerDB.getCustomization(sender.name, "nametag", "chat") !== null;

    // Send message to all players except those who muted the sender
    let messageShown = false;
    for (const player of world.getPlayers()) {
        const playerMuteSettings = muteSettings[player.name] || { muted: [], exceptions: [] };

        // Player is muted if:
        // 1. muteAll is enabled and they're not in exceptions, OR
        // 2. muteAll is disabled and they're in the muted list
        const isMuted = (playerMuteSettings.muteAll && !playerMuteSettings?.exceptions?.includes(sender.name)) ||
            (!playerMuteSettings.muteAll && playerMuteSettings?.muted?.includes(sender.name));

        if (!isMuted) {
            const showRealName = showAlias[player.name] && hasCustomNametag;
            const senderDisplay = showRealName ? `${displayName} (${sender.name})` : displayName;

            const formattedMsg = `${title}${title ? ' ' : ''}<${senderDisplay}> ${msg}`;
            player.sendMessage(formattedMsg);
            messageShown = true;
        }
    }

    // If message wasn't shown to anyone, let the sender know
    if (!messageShown) {
        sender.sendMessage(configManager.get("chatPrefix") + "§cNobody can see your messages because everyone has muted you!");
    }

});

// Log player joins
world.afterEvents.playerSpawn.subscribe((event) => {
    const { player, initialSpawn } = event;
    if (initialSpawn) {
        playerDB.logPlayerJoin(player);
    }
});

// ☆ Player Join Event - Apply In-game Customizations ☆
world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;
    system.run(() => {
        playerDB.refreshPlayerNameTag(player);
    });
});

// ☆ Helper Functions ☆
function getTitle(name) {
    return playerDB.getCustomization(name, "title", "chat") || "";
}

function getNameTag(name) {
    return playerDB.getCustomization(name, "nametag", "chat") || "";
}
