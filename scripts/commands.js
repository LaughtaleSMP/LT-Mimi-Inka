import { system, world } from "@minecraft/server";
import { MenuManager } from "./menu.js";
import { configManager } from "./config.js";
import { playerDB, muteDB } from "./db.js";




function parsePlayerArgs(args) {
    const raw = args.join(' ');
    const quotedMatch = raw.match(/"([^"]+)"/);

    let playerName, remaining;
    if (quotedMatch) {
        playerName = quotedMatch[1];
        const startIndex = raw.indexOf(quotedMatch[0]) + quotedMatch[0].length;
        remaining = raw.slice(startIndex).trim().split(' ').filter(s => s);
    } else {
        playerName = args[0] || null;
        remaining = args.slice(1);
    }

    if (playerName?.startsWith('@')) playerName = playerName.slice(1);

    return { playerName, remaining };
}



class CommandManager {
    constructor() {
        this.commands = new Map();
        this._aliasMap = new Map();
    }

    register(name, options) {
        const cmdName = name.toLowerCase();
        const cmd = {
            name: cmdName,
            description: options.description || "No description provided",
            permission: options.permission || "none",
            execute: options.execute,
            aliases: (options.aliases || []).map(a => a.toLowerCase())
        };
        this.commands.set(cmdName, cmd);
        for (const alias of cmd.aliases) {
            this._aliasMap.set(alias, cmdName);
        }
    }

    has(name) {
        name = name.toLowerCase();
        return this.commands.has(name) || this._aliasMap.has(name);
    }

    get(name) {
        name = name.toLowerCase();
        return this.commands.get(name) || this.commands.get(this._aliasMap.get(name));
    }

    execute(player, name, args) {
        const command = this.get(name);
        if (!command) return false;

        // Check permissions using configured tags
        if (command.permission === "admin" && !configManager.hasTag(player, "adminTag")) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cYou don't have permission to use this command!`);
            return true;
        }
        if (command.permission !== "none" && command.permission !== "admin" && !player.hasTag(command.permission)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cYou don't have permission to use this command!`);
            return true;
        }

        try {
            command.execute(player, args);
        } catch (error) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cAn error occurred while executing the command!`);
            console.warn(`Error executing command ${name}: ${error}`);
        }
        return true;
    }

    getCommands() {
        return [...this.commands.values()];
    }
}

export const commandManager = new CommandManager();



commandManager.register("help", {
    description: "Shows list of available commands",
    permission: "none",
    execute: (player, args) => {
        const commands = commandManager.getCommands()
            .filter(cmd => {
                if (cmd.permission === "none") return true;
                if (cmd.permission === "admin") return configManager.hasTag(player, "adminTag");
                return player.hasTag(cmd.permission);
            });

        player.sendMessage(`${configManager.get("chatPrefix")}§6=== Available Commands ===`);
        for (const cmd of commands) {
            player.sendMessage(`§e${configManager.get("prefixes")[0]}${cmd.name}§7: ${cmd.description}`);
        }
    }
});

commandManager.register("menu", {
    description: "Open the Title Manager menu",
    permission: "admin",
    aliases: ["gui", "titles"],
    execute: (player) => {
        MenuManager.openMenuWithDelay(player);
    }
});



commandManager.register("setingame", {
    description: "Set in-game customization for a player",
    permission: "admin",
    execute: (player, args) => {
        const { playerName, remaining } = parsePlayerArgs(args);
        const type = remaining[0];
        let value = remaining.slice(1).join(' ');

        if (!playerName || !type || !value) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: ${configManager.get("prefixes")[0]}setingame <player> <type> <value> [position]`);
            return;
        }

        if (!["title", "nametag"].includes(type)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cInvalid type! Use: title, nametag`);
            return;
        }

        let position = "top";
        if (type === "title") {
            const parts = value.split(" ");
            const last = parts[parts.length - 1];
            if (["top", "before", "after", "below"].includes(last)) {
                position = last;
                value = parts.slice(0, -1).join(" ");
            }
        }

        playerDB.setCustomization(playerName, type, type === "title" ? { text: value, position } : value, "ingame");


        const targetPlayer = [...world.getPlayers()].find(p => p.name === playerName);
        if (targetPlayer) {
            system.run(() => playerDB.refreshPlayerNameTag(targetPlayer));
        }

        player.sendMessage(configManager.get("chatPrefix") + `§aSet in-game ${type} for ${playerName} to: ${value}${type === "title" ? ` (${position})` : ''}`);
    }
});

commandManager.register("setchat", {
    description: "Set chat customization for a player",
    permission: "admin",
    execute: (player, args) => {
        const { playerName, remaining } = parsePlayerArgs(args);
        const type = remaining[0];
        const value = remaining.slice(1).join(' ');

        if (!playerName || !type || !value) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: ${configManager.get("prefixes")[0]}setchat <player> <type> <value>`);
            return;
        }

        if (!["title", "nametag"].includes(type)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cInvalid type! Use: title, nametag`);
            return;
        }

        playerDB.setCustomization(playerName, type, value, "chat");
        player.sendMessage(`${configManager.get("chatPrefix")}§aSet chat ${type} for ${playerName} to: ${value}`);
    }
});



commandManager.register("setboth", {
    description: "Set both chat and in-game customization at once",
    permission: "admin",
    aliases: ["sb", "dual"],
    execute: (player, args) => {
        const { playerName, remaining } = parsePlayerArgs(args);
        const type = remaining[0];
        let value = remaining.slice(1).join(' ');

        if (!playerName || !type || !value) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: !setboth <player> <title|nametag> <value> [position]`);
            return;
        }

        if (!["title", "nametag"].includes(type)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cInvalid type! Use: title, nametag`);
            return;
        }

        let position = "top";
        if (type === "title") {
            const parts = value.split(" ");
            const last = parts[parts.length - 1];
            if (["top", "before", "after", "below"].includes(last)) {
                position = last;
                value = parts.slice(0, -1).join(" ");
            }
        }


        const ingameValue = type === "title" ? { text: value, position } : value;
        playerDB.batchSetCustomizations([
            { player: playerName, type, value, mode: "chat" },
            { player: playerName, type, value: ingameValue, mode: "ingame" }
        ]);


        const targetPlayer = [...world.getPlayers()].find(p => p.name === playerName);
        if (targetPlayer) {
            system.run(() => playerDB.refreshPlayerNameTag(targetPlayer));
        }

        player.sendMessage(`${configManager.get("chatPrefix")}§aSet ${type} for ${playerName} in §eboth§a chat+ingame: ${value}${type === "title" ? ` (${position})` : ''}`);
    }
});



commandManager.register("setbulk", {
    description: "Set title/nametag for multiple players (both chat+ingame)",
    permission: "admin",
    aliases: ["bulk"],
    execute: (player, args) => {
        if (args.length < 3) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: !setbulk <title|nametag> <value> @player1 @player2 ...`);
            player.sendMessage(`§7Example: §e!setbulk title ⚔ @Player1 @Player2`);
            player.sendMessage(`§7Example: §e!setbulk nametag CoolName @online`);
            return;
        }

        const type = args[0]?.toLowerCase();
        if (!["title", "nametag"].includes(type)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cInvalid type! Use: title, nametag`);
            return;
        }


        const targetArgs = [];
        const valueArgs = [];
        for (let i = 1; i < args.length; i++) {
            if (args[i].startsWith('@')) {
                targetArgs.push(args[i].slice(1));
            } else {
                valueArgs.push(args[i]);
            }
        }

        const value = valueArgs.join(' ');
        if (!value) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cPlease specify a value!`);
            return;
        }

        // Resolve @online → all online player names
        let playerNames;
        if (targetArgs.includes("online")) {
            playerNames = [...world.getPlayers()].map(p => p.name);
        } else {
            playerNames = targetArgs;
        }

        if (playerNames.length === 0) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cNo players specified! Use @PlayerName or @online`);
            return;
        }


        const operations = [];
        for (const name of playerNames) {
            operations.push({ player: name, type, value, mode: "chat" });
            const ingameValue = type === "title" ? { text: value, position: "top" } : value;
            operations.push({ player: name, type, value: ingameValue, mode: "ingame" });
        }

        playerDB.batchSetCustomizations(operations);


        const onlinePlayers = [...world.getPlayers()];
        system.run(() => {
            for (const name of playerNames) {
                const target = onlinePlayers.find(p => p.name === name);
                if (target) playerDB.refreshPlayerNameTag(target);
            }
        });

        player.sendMessage(`${configManager.get("chatPrefix")}§aSet ${type} for §e${playerNames.length}§a players: ${playerNames.join(', ')}`);
    }
});



commandManager.register("remove", {
    description: "Remove a customization from a player",
    permission: "admin",
    aliases: ["removecustom"],
    execute: (player, args) => {
        const { playerName, remaining } = parsePlayerArgs(args);
        const type = remaining[0];
        const mode = remaining[1];

        if (!playerName || !type || !mode) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: ${configManager.get("prefixes")[0]}remove <player> <type> <mode>`);
            return;
        }

        if (!["title", "nametag"].includes(type)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cInvalid type! Use: title, nametag`);
            return;
        }

        if (!["chat", "ingame"].includes(mode)) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cInvalid mode! Use: chat, ingame`);
            return;
        }

        playerDB.removeCustomization(playerName, type, mode);
        player.sendMessage(`${configManager.get("chatPrefix")}§aRemoved ${mode} ${type} for ${playerName}`);


        if (mode === "ingame") {
            const targetPlayer = [...world.getPlayers()].find(p => p.name === playerName);
            if (targetPlayer) {
                system.run(() => playerDB.refreshPlayerNameTag(targetPlayer));
            }
        }
    }
});



commandManager.register("muteall", {
    description: "Toggle muting all players for yourself",
    permission: "none",
    execute: (player) => {
        let muteSettings = muteDB.get("muteSettings", {});
        muteSettings[player.name] = muteSettings[player.name] || {};
        muteSettings[player.name].muteAll = !muteSettings[player.name].muteAll;


        if (muteSettings[player.name].muteAll) {
            muteSettings[player.name].exceptions = [];
        }

        muteDB.set("muteSettings", muteSettings);
        player.sendMessage(muteSettings[player.name].muteAll
            ? `${configManager.get("chatPrefix")}§aAll players will now be muted (except those you unmute)`
            : `${configManager.get("chatPrefix")}§aAll players will now be unmuted (except those you mute)`
        );
    }
});

commandManager.register("mute", {
    description: "Mute a player for yourself",
    permission: "none",
    execute: (player, args) => {
        if (args.length < 1) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: !mute <player>`);
            return;
        }

        const { playerName: targetName } = parsePlayerArgs(args);

        let muteSettings = muteDB.get("muteSettings", {});
        muteSettings[player.name] = muteSettings[player.name] || { muted: [], exceptions: [] };

        if (!muteSettings[player.name]?.muted?.includes(targetName)) {
            muteSettings[player.name]?.muted?.push(targetName);
            const index = muteSettings[player.name].exceptions.indexOf(targetName);
            if (index !== -1) {
                muteSettings[player.name].exceptions.splice(index, 1);
            }
            player.sendMessage(`${configManager.get("chatPrefix")}§aMuted player: ${targetName}`);
        } else {
            player.sendMessage(`${configManager.get("chatPrefix")}§ePlayer ${targetName} is already muted!`);
        }

        muteDB.set("muteSettings", muteSettings);
    }
});

commandManager.register("unmute", {
    description: "Unmute a player",
    permission: "none",
    execute: (player, args) => {
        if (args.length < 1) {
            player.sendMessage(`${configManager.get("chatPrefix")}§cUsage: !unmute <player>`);
            return;
        }

        const { playerName: targetName } = parsePlayerArgs(args);

        let muteSettings = muteDB.get("muteSettings", {});
        muteSettings[player.name] = muteSettings[player.name] || { muted: [], exceptions: [] };

        if (!muteSettings[player.name].exceptions.includes(targetName)) {
            muteSettings[player.name].exceptions.push(targetName);
            const index = muteSettings[player.name].muted.indexOf(targetName);
            if (index !== -1) {
                muteSettings[player.name].muted.splice(index, 1);
            }
            player.sendMessage(`${configManager.get("chatPrefix")}§aUnmuted player: ${targetName}`);
        } else {
            player.sendMessage(`${configManager.get("chatPrefix")}§ePlayer ${targetName} is already unmuted!`);
            return;
        }

        muteDB.set("muteSettings", muteSettings);
    }
});

commandManager.register("mutelist", {
    description: "List players you have muted",
    permission: "none",
    execute: (player) => {
        const muteSettings = muteDB.get("muteSettings", {});
        const playerSettings = muteSettings[player.name] || {};

        if (playerSettings.muteAll) {
            const exceptions = playerSettings.exceptions || [];
            if (exceptions.length === 0) {
                player.sendMessage(configManager.get("chatPrefix") + "§6All players are muted with no exceptions!");
            } else {
                player.sendMessage(configManager.get("chatPrefix") + "§6=== Mute Status ===");
                player.sendMessage("§7All players are muted except:");
                for (const name of exceptions) {
                    player.sendMessage(`§7- §f${name}`);
                }
            }
        } else {
            const muted = playerSettings.muted || [];
            if (muted.length === 0) {
                player.sendMessage(configManager.get("chatPrefix") + "§eYou haven't muted any players!");
                return;
            }
            player.sendMessage(configManager.get("chatPrefix") + "§6=== Muted Players ===");
            for (const name of muted) {
                player.sendMessage(`§7- §f${name}`);
            }
        }
    }
});

commandManager.register("alias", {
    description: "Toggle showing real player gamertags in chat",
    permission: "none",
    execute: (player) => {
        let showAlias = playerDB.get("showAlias", {});
        showAlias[player.name] = !showAlias[player.name];
        playerDB.set("showAlias", showAlias);

        player.sendMessage(showAlias[player.name]
            ? configManager.get("chatPrefix") + "§aReal player gamertags will now be shown in chat"
            : configManager.get("chatPrefix") + "§aReal player gamertags will now be hidden in chat"
        );
    }
});
