import { world } from "@minecraft/server";
import { configManager, defaultConfig } from "./config.js";
import { commandManager } from "./commands.js";
import { playerDB } from "./db.js";

// Register admin commands
commandManager.register("config", {
    description: "Manage addon configuration",
    permission: "admin",
    execute: (player, args) => {
        showConfig(player);
        return;
    }
});

// Global mute commands
commandManager.register("globalmute", {
    description: "Enable/disable global chat mute",
    permission: "admin",
    aliases: ["gmute", "servermute"],
    execute: (player, args) => {
        const currentState = configManager.get("globalMute");
        const newState = args[0]?.toLowerCase() === "off" ? false : true;

        if (newState === currentState) {
            player.sendMessage(`${configManager.get("chatPrefix")}§eGlobal mute is already ${newState ? "enabled" : "disabled"}!`);
            return;
        }

        configManager.set("globalMute", newState);

        // Broadcast to all players
        const message = newState
            ? `${configManager.get("chatPrefix")}§c§lGlobal mute enabled! Chat is now disabled.`
            : `${configManager.get("chatPrefix")}§a§lGlobal mute disabled! Chat is now enabled.`;

        for (const p of world.getPlayers()) {
            p.sendMessage(message);
        }
    }
});

function formatTimestamp(ms) {
    const date = new Date(ms);
    const now = Date.now();
    const diff = now - ms;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours   = Math.floor(minutes / 60);
    const days    = Math.floor(hours / 24);

    let relative = "";
    if (days > 0) relative = `${days} day${days > 1 ? "s" : ""} ago`;
    else if (hours > 0) relative = `${hours} hour${hours > 1 ? "s" : ""} ago`;
    else if (minutes > 0) relative = `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    else relative = "just now";

    return `${date.toLocaleString()} (§7${relative}§r)`;
}
commandManager.register("playerinfo", {
    description: "Show player information (page [num])",
    permission: "admin",
    execute: (player, args) => {
        const info = playerDB.getAllPlayerLogs();
        const pageSize = 10;
        const totalPages = Math.ceil(Object.keys(info).length / pageSize);
        const pageNum = Math.max(1, Math.min(totalPages, parseInt(args[0]) || 1));
        
        // === PAGINATED CHAT (KEEP ORIGINAL RELATIVE DATES) ===
        const start = (pageNum - 1) * pageSize;
        const end = start + pageSize;
        const pagePlayers = Object.entries(info).slice(start, end);
        
        player.sendMessage(`${configManager.get("chatPrefix")}§ePlayer Info: Page ${pageNum}/${totalPages} (${Object.keys(info).length} total)`);
        
        for (const [name, data] of pagePlayers) {
            // Chat: Keep full original format with relative dates + colors
            player.sendMessage(`§r§e"${name}": {`);
            player.sendMessage(`  §r§7"firstJoin": §f${formatTimestamp(data.firstJoin)},`);
            player.sendMessage(`  §r§7"lastJoin": §f${formatTimestamp(data.lastJoin)},`);
            player.sendMessage(`  §r§7"joinCount": §f${data.joinCount}`);
            player.sendMessage(`§e},`);
        }
        
        if (pageNum < totalPages) {
            player.sendMessage(`§aNext: /playerinfo ${pageNum + 1} | Prev: /playerinfo ${pageNum - 1}`);
        }
        
        // === CLEAN CSV TO CONSOLE (timestamps only) ===
        let csvContent = "Player,FirstJoin,LastJoin,JoinCount\n";
        for (const [name, data] of Object.entries(info)) {
            const rawFirst = formatTimestamp(data.firstJoin);
            const rawLast = formatTimestamp(data.lastJoin);
            // Clean for CSV: remove relative parts + color codes
            const cleanFirst = rawFirst.split('(')[0].trim().replace(/§[0-9a-fk-or]/g, '');
            const cleanLast = rawLast.split('(')[0].trim().replace(/§[0-9a-fk-or]/g, '');
            
            csvContent += `"${name}","${cleanFirst}","${cleanLast}","${data.joinCount}"\n`;
        }
        
        const safeName = player.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const filename = `playerinfo_${safeName}_p${pageNum}_${Date.now()}.csv`;
        
        console.warn(`\n=== ${player.name} PLAYERINFO CSV (Page ${pageNum}) ===`);
        console.warn(`Filename: ${filename}`);
        console.warn(csvContent);
        console.warn(`=== COPY TO GOOGLE SHEETS ===\n`);
        
        player.sendMessage(`§a✅ Chat: Full relative dates | Console: Clean CSV!`);
    }
});



// Helper functions
function showConfig(player) {
    const config = configManager.getAll();
    player.sendMessage(`${configManager.get("chatPrefix")}§6=== Current Configuration ===`);

    // Iterate through all config items and print them
    for (const [key, value] of Object.entries(config)) {
        if (Array.isArray(value)) {
            player.sendMessage(`§e${key}: §f${value.join(', ')}`);
        } else if (typeof value === 'object') {
            player.sendMessage(`§e${key}: §f${JSON.stringify(value).replace(/"/g, '')}`);
        } else {
            player.sendMessage(`§e${key}: §f${value}`);
        }
    }
}