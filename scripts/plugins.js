import { world, system, ItemTypes, ItemStack, GameMode } from "@minecraft/server";
import { commandManager } from "./commands";
import { playerDB } from "./db";

world.afterEvents.worldLoad.subscribe(() => {
    // Pre-compute all item data once at startup (PERFORMANCE BOOST)
    const ALL_ITEMS = ItemTypes.getAll().map(itemType => ({
        item: itemType.id,
        maxAmount: new ItemStack(itemType.id).maxAmount
    }));

    class EnderChestScanner {
        constructor(player) {
            this.player = player;
        }

        /**
         * Helper to run a command safely and return boolean success
         */
        runCommand(command) {
            try {
                const result = this.player.runCommand(command);
                return result.successCount > 0;
            } catch (e) {
                return false;
            }
        }

        /**
         * Check if player has an item anywhere in their Ender Chest
         */
        hasItem(itemData) {
            return this.runCommand(
                `testfor @s[hasitem={location=slot.enderchest, item=${itemData.item}}]`
            );
        }

        /**
         * Check if a specific slot has at least a certain quantity
         */
        hasQuantity(slot, itemData, quantity) {
            return this.runCommand(
                `testfor @s[hasitem={location=slot.enderchest, slot=${slot}, item=${itemData.item}, quantity=${quantity}..}]`
            );
        }

        /**
         * Use binary search to find exact quantity in a slot
         */
        exactQuantity(slot, itemData) {
            let low = 1;
            let high = itemData.maxAmount;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);

                if (this.hasQuantity(slot, itemData, mid)) {
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            return high;
        }

        /**
         * Scans the player's Ender Chest and returns a Promise with the contents
         */
        getContents() {
            const results = new Map();
            const foundItems = new Set();
            const scanner = this;

            return new Promise(resolve => {
                const scanGenerator = function* () {

                    // Phase 1: Pre-scan to find which items exist
                    for (const itemData of ALL_ITEMS) {
                        if (scanner.hasItem(itemData)) {
                            foundItems.add(itemData);
                        }
                        yield;
                    }

                    // Phase 2: Check each slot for the items we found
                    for (let slot = 0; slot < 27; slot++) {
                        for (const itemData of foundItems) {
                            if (!scanner.hasQuantity(slot, itemData, 1)) {
                                continue;
                            }

                            const amount = scanner.exactQuantity(slot, itemData);
                            results.set(slot, {
                                amount: amount,
                                slot: slot,
                                item: itemData.item
                            });

                            break; // Move to next slot
                        }
                        yield;
                    }

                    // ✅ CRITICAL: Resolve the Promise INSIDE the generator
                    resolve(results);
                };

                system.runJob(scanGenerator());
            });
        }
    }
    // Track players who have activated the TPS stream

    commandManager.register("test", {
        description: "Custom test command example",
        permission: "admin",
        aliases: ["test"],
        execute: (sender, args) => {
            sender.sendMessage(`§eTest§f: ${args.join(" ")}`);
        }
    });

    // Command registration
    commandManager.register("enderchest", {
        description: "Scan Player Ender Chest",
        permission: "admin",
        aliases: ["ec"],
        execute: async (sender, args) => {
            const targetPlayerName = args[0];
            const targetPlayer = world.getAllPlayers().find(p => p.name === targetPlayerName);

            if (!targetPlayer) {
                sender.sendMessage("§cPlayer not found!");
                return;
            }

            sender.sendMessage(`§eScanning ${targetPlayer.name}'s Ender Chest...`);

            try {
                const scanner = new EnderChestScanner(targetPlayer);
                const contents = await scanner.getContents();

                if (contents.size === 0) {
                    sender.sendMessage(`§7${targetPlayer.name}'s Ender Chest is empty`);
                    return;
                }

                sender.sendMessage(`§aFound ${contents.size} items:`);

                contents.forEach((itemData, slot) => {
                    sender.sendMessage(`§7Slot ${slot + 1}: §f${itemData.item} §7x${itemData.amount}`);
                });

            } catch (error) {
                sender.sendMessage(`§cError scanning Ender Chest: ${error.message}`);
                console.error(error);
            }
        }
    });
})
const tpsStreamers = new Set();

commandManager.register("e", {
    description: "Check entity around players",
    permission: "admin",
    aliases: ["e"],
    execute: (sender, args) => {
        getMobs(sender)
    }
});

commandManager.register("tps", {
    description: "Check server TPS",
    permission: "none",
    aliases: ["tps"],
    execute: (sender, args) => {
        const startTime = Date.now()
        const players = world.getPlayers().length
        system.runTimeout(() => {
            const theTPS = (1000 * 20 / (Date.now() - startTime)).toFixed(2)
            sender.sendMessage("tps=" + theTPS + " players=" + players)
        }, 20)
    }
});

commandManager.register("stps", {
    description: "Stream server TPS every second",
    permission: "admin",
    aliases: ["stps"],
    execute: (sender, args) => {
        const playerName = sender.name;

        if (tpsStreamers.has(playerName)) {
            // Stop streaming TPS for the player
            tpsStreamers.delete(playerName);
            sender.sendMessage(`§cTPS streaming stopped.`);
        } else {
            // Start streaming TPS for the player
            tpsStreamers.add(playerName);
            sender.sendMessage(`§aTPS streaming started. Run §e/streamtps §ato stop.`);
        }
    }
});

// Function to calculate TPS
function calculateTPS(startTime) {
    return (1000 * 20 / (Date.now() - startTime)).toFixed(2);
}

// Periodically update TPS for active streamers
system.runInterval(() => {
    const startTime = Date.now(); // Start time for TPS calculation
    const players = world.getPlayers();

    // Calculate TPS after 20 ticks (1 second)
    system.runTimeout(() => {
        const theTPS = calculateTPS(startTime);

        // Send TPS to all active streamers
        for (const playerName of tpsStreamers) {
            // Find the player by filtering through online players
            const player = players.find(p => p && p.name === playerName);
            if (player) {
                // Create the action bar message
                const actionBarMessage = [
                    `§bTPS: §f${theTPS}`, // TPS value
                    `§7Online: §f${players.length}` // Player count
                ].join(" §r|§r "); // Join with a separator

                // Display the message in the action bar
                player.onScreenDisplay.setActionBar(actionBarMessage);
            } else {
                // Remove inactive players from the set
                tpsStreamers.delete(playerName);
            }
        }
    }, 20); // 20 ticks = 1 second delay
}, 20); // Run every second

commandManager.register("gms", {
    description: "Gamemode Survival",
    permission: "admin",
    aliases: ["gms"],
    execute: (sender, args) => {
        system.run(() => {
            sender.setGameMode(GameMode.Survival)
            sender.removeEffect('night_vision')
        })
    }
});

commandManager.register("gmp", {
    description: "Gamemode Spectator",
    permission: "admin",
    aliases: ["gmp"],
    execute: (sender, args) => {
        system.run(() => {
            sender.setGameMode(GameMode.Spectator)
        })
    }
});

commandManager.register("gmc", {
    description: "Gamemode Creative",
    permission: "admin",
    aliases: ["gmc"],
    execute: (sender, args) => {
        system.run(() => {
            sender.setGameMode(GameMode.Creative)
        })
    }
});

commandManager.register("op", {
    description: "Give operator to a player",
    permission: "admin",
    aliases: ["op"],
    execute: (sender, args) => {
        const target = args.join(' ');
        if (!target) {
            sender.sendMessage("§cUsage: .op <player>");
            return;
        }
        system.run(() => {
            try {
                sender.runCommand(`op "${target}"`);
                sender.sendMessage(`§aOp granted to §e${target}`);
            } catch (e) {
                sender.sendMessage(`§cFailed to op ${target}: ${e.message}`);
            }
        });
    }
});

commandManager.register("deop", {
    description: "Remove operator from a player",
    permission: "admin",
    aliases: ["deop"],
    execute: (sender, args) => {
        const target = args.join(' ');
        if (!target) {
            sender.sendMessage("§cUsage: .deop <player>");
            return;
        }
        system.run(() => {
            try {
                sender.runCommand(`deop "${target}"`);
                sender.sendMessage(`§aOp removed from §e${target}`);
            } catch (e) {
                sender.sendMessage(`§cFailed to deop ${target}: ${e.message}`);
            }
        });
    }
});

commandManager.register("nv", {
    description: "Night Vision.",
    permission: "admin",
    aliases: ["nv"],
    execute: (sender, args) => {
        system.run(() => {
            sender.addEffect('night_vision', 86400 * 20, {
                amplifier: 1,
                showParticles: false
            })
        })
    }
});

commandManager.register("rnv", {
    description: "Remove Night Vision.",
    permission: "admin",
    aliases: ["rnv"],
    execute: (sender, args) => {
        system.run(() => {
            sender.removeEffect('night_vision')
        })
    }
});

commandManager.register("tp", {
    description: "Teleport",
    permission: "admin",
    aliases: ["tp"],
    execute: (sender, args) => {
        const tpTarget = (args.join(' ')).split('@')[1] || args.join(' ')
        system.run(async () => {
            if (sender.getGameMode() !== GameMode.Spectator) {
                sender.setGameMode(GameMode.Spectator)
            }

            // Add delay before teleporting
            system.runTimeout(() => {
                sender.runCommand('tp @s ' + tpTarget)
            }, 40) // 40 ticks = 2 second delay
        })
    }
});

commandManager.register("ml", {
    description: "Open Mimi Land GUI",
    permission: "none",
    aliases: ["ml"],
    execute: (sender, args) => {
        system.run(() => sender.sendMessage(`§l[§r§eMimi Land§f§l]§r §aSuccess! Close this Chat GUI and wait 5 secs.`))
        try {
            system.runTimeout(() => {
                sender.runCommand('scriptevent mimi:land-gui')
            }, 20 * 5)
        } catch (err) {

        }
    }
});

world.afterEvents.playerSpawn.subscribe((event) => {
    const player = event.player;

    system.runTimeout(() => {
        player.sendMessage('Welcome to §aLaughtale§r!')
        player.sendMessage('Ketik §d.help atau /guide§r untuk bantuan server.')
    }, 40)
});

function getMobs(moderator) {
    let [globalMobs, overworldMobs, netherMobs, endMobs, playerMobs] = getMobsNearPlayers(moderator)

    // Helper function to group entities by category
    const groupEntities = (entities) => {
        let grouped = {}
        for (const [type, amount] of Object.entries(entities)) {
            // console.log(JSON.stringify(type))
            let category = type
            // let category = type.split('_')[0]
            if (!grouped[category]) {
                grouped[category] = 0
            }
            grouped[category] += amount
        }
        return grouped
    }

    // Print individual player summaries in a single line
    for (const player of playerMobs) {
        let entities = groupEntities(player.types)
        // console.log(JSON.stringify(entities))
        let summary = Object.entries(entities).map(([category, count]) => `${count}×${category}`).join(' | ')
        // console.log(JSON.stringify(summary))
        sayInChat(moderator, `§4${player.name} §b[Total:${player.count}] §e${player?.location} (${player.dimension}) - §a${summary}`)
    }

    // Print global statistics
    // console.log('global summary')
    let globalEntities = groupEntities(globalMobs)
    let globalSummary = Object.entries(globalEntities).map(([category, count]) => `${count}×${category}`).join(' | ')
    // console.log('after global summary')
    // console.log(JSON.stringify(globalSummary))
    sayInChat(moderator, `§6Global Statistics [Total: ${Object.values(globalMobs).reduce((a, b) => a + b, 0)}] - §a${globalSummary}`)
}

function getMobsNearPlayers(moderator) {
    let players = world.getPlayers()
    let [globalMobs, overworldMobs, netherMobs, endMobs, playerMobs] = [{}, {}, {}, {}, []]
    let counted = []

    for (const player of players) {
        const dimensionEntities = world.getDimension(player.dimension.id).getEntities({ location: player.location, maxDistance: 128 })
        let playerEntityTypes = {}

        for (const entity of dimensionEntities) {
            let mobType = (obj, type) => (obj[type] = (obj[type] || 0) + 1)

            switch (entity.dimension.id) {
                case "minecraft:overworld":
                    mobType(overworldMobs, entity.typeId)
                    break
                case "minecraft:nether":
                    mobType(netherMobs, entity.typeId)
                    break
                case "minecraft:the_end":
                    mobType(endMobs, entity.typeId)
                    break
            }

            if (!counted.includes(entity.id)) {
                mobType(globalMobs, entity.typeId)
                counted.push(entity.id)
            }
            if (entity.dimension.id === player.dimension.id) {
                mobType(playerEntityTypes, entity.typeId)
            }
        }
        let playerMobCount = Object.values(playerEntityTypes).reduce((a, b) => a + b, 0)
        // console.log(JSON.stringify(player.location))
        // Round the coordinates
        let roundedLocation = {}

        try {
            roundedLocation = {
                x: Math.round(player.location.x),
                y: Math.round(player.location.y),
                z: Math.round(player.location.z)
            };
        } catch (error) {
            console.warn('Ehhh, inka:plugins.js:277 Tolong bilang yotbu :> Errornya: ' + error)
        }

        try {
            playerMobs.push({
                name: player.name,
                count: playerMobCount,
                dimension: player.dimension.id.replace('minecraft:', ''),
                location: `${roundedLocation.x}, ${roundedLocation.y}, ${roundedLocation.z}`, // Rounded coordinates as a string
                types: playerEntityTypes
            })
        } catch (error) {
            console.warn('Ehhh, inka:plugins.js:289 Tolong bilang yotbu :> Errornya: ' + error)
        }
    }
    return [globalMobs, overworldMobs, netherMobs, endMobs, playerMobs]
}


function sayInChat(target, text) {
    text = text.split("minecraft:").join("")
    target.sendMessage(text)
}

// Base64 encoding function (simplified to only what we need)
const base64 = {
    encode: function (str) {
        const input = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
            function toSolidBytes(match, p1) {
                return String.fromCharCode('0x' + p1);
            });

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let output = '';
        let i = 0;

        while (i < input.length) {
            const chr1 = input.charCodeAt(i++);
            const chr2 = i < input.length ? input.charCodeAt(i++) : NaN;
            const chr3 = i < input.length ? input.charCodeAt(i++) : NaN;

            const enc1 = chr1 >> 2;
            const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            const enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            const enc4 = chr3 & 63;

            output += chars.charAt(enc1) + chars.charAt(enc2) +
                (isNaN(chr2) ? '=' : chars.charAt(enc3)) +
                (isNaN(chr3) ? '=' : chars.charAt(enc4));
        }

        return output;
    },

    decode: function (str) {
        // First, clean the input string
        str = str.replace(/[^A-Za-z0-9+/=]/g, '');

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        let output = '';
        let i = 0;

        while (i < str.length) {
            const enc1 = chars.indexOf(str.charAt(i++));
            const enc2 = chars.indexOf(str.charAt(i++));
            const enc3 = chars.indexOf(str.charAt(i++));
            const enc4 = chars.indexOf(str.charAt(i++));

            const chr1 = (enc1 << 2) | (enc2 >> 4);
            const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            const chr3 = ((enc3 & 3) << 6) | enc4;

            output += String.fromCharCode(chr1);
            if (enc3 !== 64) output += String.fromCharCode(chr2);
            if (enc4 !== 64) output += String.fromCharCode(chr3);
        }

        try {
            return decodeURIComponent(output.split('').map(function (c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
        } catch (e) {
            return output;
        }
    }
};

// To import customizations, replace this string with your base64 data
// Example: const importCustomizationsData = "eyJwbGF5ZXJzIjp7fX0=";
const importCustomizationsData = ""
const importCustomizationsDataFromS11 = "eyJzYXlhYWZrIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWWFuU2hlbGJ5NTc4Ijp7ImluZ2FtZSI6e30sImNoYXQiOnsidGl0bGUiOiLun4EifX0sInlvdGJ1Ijp7ImNoYXQiOnsibmFtZXRhZyI6Iu6cse6csyJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6cse6csyJ9fSwiUnViaWN1YmUwMDciOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunY4ifSwiY2hhdCI6eyJuYW1ldGFnIjoi7p26In19LCJ5b3RidWFmayI6eyJjaGF0Ijp7fSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLunIEiLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwieFZpbnM0RmEiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7py9In0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7py9In19LCJQYWtEamkwOTk5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p2QIiwicG9zaXRpb24iOiJ0b3AifX0sImNoYXQiOnsidGl0bGUiOiLunZAifX0sImRhYW5paXlhYSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+BIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7py/IiwicG9zaXRpb24iOiJ0b3AifX19LCJpQ29ybnlGaSI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunYgifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunYgifX0sIkJsYWNrIERhbWVuZCI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunJwiLCJ0aXRsZSI6Iu6egCJ9LCJpbmdhbWUiOnt9fSwiYWxscDI4MDQiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fgSJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6cviIsInBvc2l0aW9uIjoidG9wIn19fSwiT3hUeWdyYW0xIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2UIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6dlCJ9fSwiTWFzaWhrdWxpamF3YSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJlemhhMDRGIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p6AIn19LCJrZWl6eXJvIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6cvCIsInRpdGxlIjoi7p6AIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7py8In19LCJSYWZsZWhoaGgiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLun4AiLCJ0aXRsZSI6eyJ0ZXh0Ijoi7p+BIiwicG9zaXRpb24iOiJ0b3AifX0sImNoYXQiOnsidGl0bGUiOiLun4EiLCJuYW1ldGFnIjoi7p+AIn19LCJ5b3RidXR3byI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkl0YWRvcmlTaGluNjU0MCI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunYoiLCJ0aXRsZSI6Iu6dkSJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6diiIsInRpdGxlIjp7InRleHQiOiLunZEiLCJwb3NpdGlvbiI6InRvcCJ9fX0sIlNoZWxsZG93bjE3Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWmFwcnVuMjEyMCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIllvdXJiYWU5OXoiOnsiY2hhdCI6eyJ0aXRsZSI6IsKnY1hSQVlFUiJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkVYbWlsaW9uMTA1NiI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunYYifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunYYifX0sIlNhbGx0MzkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLunoAifX0sIkZpZXJ5UGhvZW5peDY4OCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFuYWtJbGhhbTEyIjp7ImNoYXQiOnsidGl0bGUiOiLunJ8ifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJQYXVsZGl6MjciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLun4QiLCJuYW1ldGFnIjoiUGF1bCBoYW1hIn19LCJwYWlqYW5wcm8iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6cqSJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImJ1dHRlcmZseXl5eTg0MCI6eyJjaGF0Ijp7InRpdGxlIjoi7pyOIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUWluMjI0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWmVhc2tyaTIzNCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkNsb3ZlckdTTCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fSwiY2hhdCI6eyJ0aXRsZSI6Iu6dryJ9fSwiSWJudTIwMjA5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTmF0c3VZdWtpaW5vIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6euiIsInRpdGxlIjoi7p6AIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifSwibmFtZXRhZyI6Iu6euiJ9fSwiSVRhc3lhYSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6esSJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunrEifX0sIlNhdHVybnVzcGlvMTkiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p6WIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6WIn19LCJMaXR0bGUgQ2lodXkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLunoAiLCJwb3NpdGlvbiI6InRvcCJ9fSwiY2hhdCI6eyJ0aXRsZSI6Iu6egCJ9fSwiUXVlZW5KdWl0YWEiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fgSIsIm5hbWV0YWciOiLunpoifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunpoifX0sIkFyZGVudFJlZ2FsaWEiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6criIsIm5hbWV0YWciOiLunYkifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLunK4iLCJwb3NpdGlvbiI6InRvcCJ9LCJuYW1ldGFnIjoi7p2JIn19LCJKb25pIDAxODg3MiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk95UWk5OSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFxdWFSYXB0b3IxMjQ4MiI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6dmSJ9LCJjaGF0Ijp7InRpdGxlIjoi7pyuIiwibmFtZXRhZyI6Iu6dmSJ9fSwiSXFiYWwgSm9zdGFyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSElMTElVTUFUSUMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLuna8ifX0sIkRldmluZUxpbGl0aDIwNyI6eyJjaGF0Ijp7InRpdGxlIjoi7pyOIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUHBpdHlvZSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImNoaWl6eXk1MjMyIjp7ImNoYXQiOnsidGl0bGUiOiLunYUiLCJuYW1ldGFnIjoi7p2EIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2EIn19LCJQUklOQ0U1MTkzNiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlpvZXhha2EgWVQiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p+RIiwidGl0bGUiOiLun4EifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLun5EifX0sIk1pa2FzYTU5MjAiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fgSIsIm5hbWV0YWciOiLun5IifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLun5IifX0sIll1dXplaW45Njk2OSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkJsaUdERTY5Ijp7ImNoYXQiOnsidGl0bGUiOiLunYUiLCJuYW1ldGFnIjoi7py7In0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7py7In19LCJBbWlyb3Y0MTg3Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWWFyRXg2MjQ5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwia2Vub21vb29ubiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkVhcmxGa3J5eTg2NjIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLunZEifX0sInBpYWEwMDYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSeXV1dW1hYWEiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6egCJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6egCIsInBvc2l0aW9uIjoidG9wIn19fSwiT25pIENoYW41NDY0Ijp7ImNoYXQiOnsibmFtZXRhZyI6IkJ1d25hbmEiLCJ0aXRsZSI6Iu6fgSJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6fgSIsInBvc2l0aW9uIjoidG9wIn19fSwiQWRpSGlqYXUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMYXJhY21pdzI0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU3BsYXNoQm90dGxlNjY5Ijp7ImNoYXQiOnsidGl0bGUiOiLunLcifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJLNE4xODRMIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQWRpZmFhbmFzaGFhIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRm9nZ3lHb2xkMzY3OTMzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p2vIn19LCJUcmFhbGFsYTI2Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRmF6emxpaCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJpZFN0ZTFuIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7py5In19LCJSaW5TcGljeVJoaW4iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJGYW1yaUhpZGF5YXQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNb3JnYW5PY2MzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p2RIn19LCJDQUJFRUVFRUVFIjp7ImNoYXQiOnsidGl0bGUiOiLunI4ifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJuZXNjaW5kbzAwIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7Im5hbWV0YWciOiLunZ0ifX0sIk9uZSBrZVk0NDYyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2VuZGFleWkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJkYW1lbmRhZmsiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLunqAiLCJwb3NpdGlvbiI6InRvcCJ9fSwiY2hhdCI6eyJ0aXRsZSI6Iu6egCJ9fSwiQWxpYSBjaWVudHJpIjp7ImNoYXQiOnsidGl0bGUiOiLunJ8iLCJuYW1ldGFnIjoiwqdiQWxpYS0ifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLCp2JBbGlhLSIsInBvc2l0aW9uIjoiYWJvdmUifX19LCJvYnl5MjM1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwicmFiYml0YmllejU5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiemllZTAwMSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6djCJ9LCJjaGF0Ijp7InRpdGxlIjoi7p2NIn19LCJOYWlsMTcxMCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fSwiY2hhdCI6eyJ0aXRsZSI6Iu6dkSJ9fSwiQmFjaGlsYXN6Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRHpha3k1NTY1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWmhha3VyYWEiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p2HIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p2HIiwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlNoaXJhenkwNyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkRhemFhU2FuIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJXaWxkYW4yMjAxMTAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJQZW5pbnN1bGE2MjQ3Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVWNoaWhhUml5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7Im5hbWV0YWciOiLunbEifX0sIlJ1ZGk5MTk1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p2fIn19LCJtYWFlYmVsbCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFsaW5rYWExMzQ1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwicG9rZXJpbCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6duSIsInBvc2l0aW9uIjoidG9wIn19LCJjaGF0Ijp7Im5hbWV0YWciOiLunowifX0sIktlbmFzaFgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLunrMifX0sIk55YWFtZTEwIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2VIn19LCJNZWdhTG9mdCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkZpbm5EcmVhbWluZzk1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p6CIn19LCJGcm9zdCBTUjQ4ODYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJOZ2toYW16YWgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLunoAifX0sImluaVBpa2FjaHUiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6egCJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6egCIsInBvc2l0aW9uIjoidG9wIn19fSwiaW5kcmFlejEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMeWhCbHVlIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiT2xpdmVyc3NzMjIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJZZW5nZzEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJ4ZXV0YXJ6MDEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJab2V4YWthNTIzMiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fSwiY2hhdCI6eyJ0aXRsZSI6Iu6dnyJ9fSwiTXVzdG9mYSBhbGkiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7pyrIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7pyrIiwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlNhYnJlaW5uYSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6dnCIsInBvc2l0aW9uIjoidG9wIn19LCJjaGF0Ijp7InRpdGxlIjoi7p2cIn19LCJGbGF4SUQxNkZSIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQWxmaW5nbTIzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVmlubkxvbmVseTEzIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6dqiJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6ctCIsInBvc2l0aW9uIjoiYWJvdmUifSwibmFtZXRhZyI6Iu6dqiJ9fSwiUmFuIGNpaHV1dXkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJUaW8gbGF4eGluZyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImtpenV5eXkxOTU0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiZW14enlsZmkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJiYXJha2E0MzQzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiS2hhYTR5b3UiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJhcnlhcGFpamFuIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwibW9uZG9sNzUyOSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6dtyJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunbcifX0sIkFpcnJvbWFpbDA2Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUGlua3lQb3UiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6dnyJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkJ1c2V0YnJvIGJvcyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6egCIsInBvc2l0aW9uIjoidG9wIn0sIm5hbWV0YWciOiLunooifSwiY2hhdCI6eyJ0aXRsZSI6Iu6chSIsIm5hbWV0YWciOiLunooifX0sIlNhcnVuZ3N1cGVyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSUNoZWVlZXNleSI6eyJjaGF0Ijp7InRpdGxlIjoi7p6AIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifX19LCJTdW5zYW1heW8iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6cnSJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkh5bG1vbmRGeCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1jWmVvblBsYXkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLunbIifX0sIlR1bmRyYXRoaWV2ZTEyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVHJhYSBFeGUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNYWtvdG9aZXJvMTA1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQU5ESSBDUkFGVDE1NDciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSdWJ5eWVheSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1velNTNDI2NyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIldlbGxaMTMyNCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIktJTkdSVUxMMyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fSwiY2hhdCI6eyJ0aXRsZSI6Iu6dkSJ9fSwiSmVzc3R5TW9vbiI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6cuiJ9fSwiVGF6aSBqZW1ldGFsYW5nIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU0FZRGlhbW9uZDEyMyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImZzaHN2c2h2ZHM2MzU4Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUHJvIGdhbWluZzgyNTciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLunZ8ifX0sInJhYmJpdCBmbG93eSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImF4RGM0IHUiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p2AIiwidGl0bGUiOiLunogifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunYAiLCJ0aXRsZSI6eyJ0ZXh0Ijoi7p6IIiwicG9zaXRpb24iOiJ0b3AifX19LCJMYXVyYWFhZG5yIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwia3Vla2VqdTE3Ijp7ImNoYXQiOnsidGl0bGUiOiLunoAiLCJuYW1ldGFnIjoi7pyoIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifSwibmFtZXRhZyI6Iu6cqCJ9fSwiWm9lZWFmayI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1JTDAwSCI6eyJjaGF0Ijp7InRpdGxlIjoi7p6AIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifX19LCJOdW5uYTI1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQXJkaWFuMzkxMiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFyc2VuaWNYRDczMzIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJEaW16T3Nha2ExMjM0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQmFieUFQQUkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJrZWl6eXJvIGFmayI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkRpYW1vbmR3ZWtlbiI6eyJjaGF0Ijp7InRpdGxlIjoi7pyfIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiZXdpbmdoYWRlIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQmxhY0s0MjEzNjYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJOYW56enozNTQzNTQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJraW5nMjA3MzUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBeWFtZ2VwcmVrMzc2MSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk51bWVyYWxMaXphcmQ1OSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sInZpb25nYW50ZW5nNjYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJjYXJyb3RUNDg4MyI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6djyJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunY8ifX0sIkJSRVpaRVJSIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSXRzSHlaYW4iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNYWdpY1hQb25kIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRHdpR2FtaW5nODkzMiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkhBUkxFUVVJTjk0NDMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifSwibmFtZXRhZyI6Iu6etSJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunrUifX0sIkI0TjRQM0wwIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVm5pbGxhdHRlZSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkltUHV4eHpZIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVmVudGVkUGVhazIzNTc5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiYSBCb2lsZWQgVG9mdSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkdldHlvdXJzaG90MSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkJyYW1zdGVyMDIyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUml6em95SSBHYW1pbmciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSQUZGIEVMTk8iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSYWZpcmlhbnoiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJPeGFsaXNDIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2hpa2FuYW1pIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p2TIiwicG9zaXRpb24iOiJ0b3AifSwibmFtZXRhZyI6Iu6dkiJ9LCJjaGF0Ijp7InRpdGxlIjoi7p2TIiwibmFtZXRhZyI6Iu6dkiJ9fSwiQXp1cmFTa3kzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifX0sImNoYXQiOnsidGl0bGUiOiLunoAifX0sIlRyaXlvMTEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJQT1BHb29kMTgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJOYXRzdXVBZmsiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMaXZlIEZvciBBRksiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTYWxzYWNoaWkxMjkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJUaGVDYW1lcmFtZW4iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJEaWtlamFyIFdhcmRlbiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImVybHlubm5aVCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkJBTkFOQTczNjkyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRiBvbmUgYWphIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiXCJCbGFjayBEYW1lbmRcIiI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6cnCJ9fSwiU2FuamlLb3Rvd2FydTEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJEb29ybWFuIHdoaWxlIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQVJDSEVSIDA4MzkyOSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkRhcmsgaUNISU1FIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTGluZWRTbWlsZTQ1NzAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJjd2NhYSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImRpYW1iZXJhcnRpQWZrIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRnV6enl5NDQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJEZXJhIEdhbnRlbmcgOTAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMYXdsaWV0YWxjaCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIldpbnRlcnoxOTQ4Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQWhtYWQgU3VodSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImZhbmt5ZmFua3oiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLCp2JbIGZhbmt5ZmFua3ogXSJ9fSwiU2hlc3NzODEwNSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJpaWtsYW5hIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTGlyYTA4MDEwOCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlNheWFuZ2thbXU4NiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sInlvdGJ1YWkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJUaGVKb2tlcjQ4NzkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNcnNEZXZpaWkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJXYWtLZWRpcHAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJIYXplbGxudXRzczg1MDMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJIYW5hbnRhODA5OSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1pa3l5OTI2NyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJvb3h4eTc5MTgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTa3lmb3Vsczc4Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2FkYWxzaHVkIjp7ImNoYXQiOnsidGl0bGUiOiLunJUifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNdXJha2ltaSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkNvcnZ1c2lvbjQyNDkiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunpsifSwiY2hhdCI6eyJuYW1ldGFnIjoi7p6bIn19LCJHYXJuYWNobzQ0OTUiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6cjiJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJPTkFMRE9KUjEyMzIyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiS2VsYWxlbjI0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUnVtYmx5TGFjZTQ0MzI5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTmVtb05hcmFhIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWWVwelBZIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2lwaXIxMjMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTaGVsbFNvdXA0MTY1NzkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJFeG1pbGlvbjEwNTYiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunYYifX0sIkFsaTUwMzIyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiaUNvcm55QUZLIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiS2l6dTM4MDQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJLSU5HWkVSTyBWSUkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJOYWNoYW5Ud1QiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBc2hib3JuTEoiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJJenp5bndhIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiaWNhbm42MjQ2Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRmF0aGFuMTUyOSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlVSRUswMDAxIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwib3Jld2Ftb3JpZSI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunLgifSwiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLunLgiLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQW1NYXVsIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVGh1bmRlcldhclYzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVmFhcm15c3RpY2FsIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRlJFWElNT04iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJWeWFuenpBbCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6dnyIsInBvc2l0aW9uIjoidG9wIn0sIm5hbWV0YWciOiLunoUifSwiY2hhdCI6eyJ0aXRsZSI6Iu6dnyIsIm5hbWV0YWciOiLunoUifX0sIkdlbnpzY2llbnRpcyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIldpenprZWN5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiYmx1ZWZhdDU3MDYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJUTlRLZXZpbjQyODUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSZWNhYWE3MTkxIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwicmV2YW56a2k1NTkzIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6cmSJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6cmSIsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBc2Ftb3didSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkhhbiBrdXR1Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRW5kZXJLaW5nMjg5MSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJleXl5Wm5uIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUmF5Z29kc3RhcnMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSYWh1bDk5OTcyNTMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMaWN5YW5uIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVGhhbGliaGFzeWltIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwic2F5YWFmaygyKSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJhemtoYVBETTExIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQWR4bHlsb3ZlMDE2MTQyIjp7ImNoYXQiOnsidGl0bGUiOiLunK4iLCJuYW1ldGFnIjoi7pyeIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7pyeIiwicG9zaXRpb24iOiJhYm92ZSJ9LCJuYW1ldGFnIjoi7p2JIn19LCJ2aW9sZW5jZW5jZSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImZlbmR5TUM0NTYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJGaW5TaGFsa2VyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSmlueFByb0EwMjUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJ1bmlvbjFzb3ZpZXQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJrdWZ1ZnVzaGkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsibmFtZXRhZyI6Iu6dmiJ9fSwiQXNzYXVsdFJhcHRvcnIiOnsiaW5nYW1lIjp7fSwiY2hhdCI6eyJ0aXRsZSI6Iu6esyJ9fSwia2hhaXJ1bGxhYiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkNyZWFtcyBCYmciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJIcnl1dWEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNYWtobHVrbWFyczc4OTAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJQdXRyaWkyNzQ4Ijp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2XIn0sImNoYXQiOnsidGl0bGUiOiLCpzRYcmF5ZXLCp2YifX0sIlRhYm9iYiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fSwiY2hhdCI6eyJ0aXRsZSI6IsKnNHhyYXllcsKnNyJ9fSwiQXNnYXJvdGg0Mzc2Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQXJub3RpcGFuYSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIldPTEYxNzY5SUQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJQYW1idWRpRXowMTIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBbGlmR2FudGVuZzIzNDUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNYXRyMXhCMW5kM3IiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJOYWNoYW4yNzE3Ijp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2lIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6dpSIsInRpdGxlIjoi7pyuIn19LCJSSVlBTiBOWCAwMiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFraG1hbDExNDYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJKdW5pb3JCb3c3MDEwMjAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBWktBMzJTS1kiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJ5ZW5nZyBra3l5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwieXV1cWluZ3lhIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUmVpQ2hhbjU3NDYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBamk3ODkyNzUzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQW50b2xpbjY2NiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkZvckRhbW1kIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTXl0aGljUmFkZW4iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMdWttYW4xNTA2Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiS29jZW5nVGVyc2VzYXQiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNYXhtYW5QYWMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSaWNoIGtldGNoZSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sImJlcnIwMDU0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRWxhbmcxNTAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJRVUVFTjYyMjI4Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifX0sImNoYXQiOnsidGl0bGUiOiLunoAifX0sInl1dXFpbmd5YSgyKSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlplbm9vTWM5OTkiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX0sImNoYXQiOnsidGl0bGUiOiLCpzbCp2xEZXdhIER1cGXCp2YifX0sIlJBRkYgU0tJQklESTYxNSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIldhaHl1dTg1NTUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJpcWlzdmFnZWFuY2UiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJFdmllIERyaXZlbjIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJWSUpFRUUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJIaWx6IHNvcGFuIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2xpbXpIZWFUIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19LCJjaGF0Ijp7InRpdGxlIjoi7p2fIn19LCJGdXNoaWd1cm91dSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlN0b25lYWdlOSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlhyb25uIFdsZSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1BU0RDT0xJTlMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJCbGFja3Bpbms0NTI3NzIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBSVpJVVVVIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWmFsaWEgY2FudGlrOTk5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiRml0cmlpaSBzbGViZXciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJEcmFjdWxhIGt1bjg3MjYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJQYW5nZ2FiZWFuMDEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJmYWlyeXljaGFsIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiR29kdHJ5MzYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTQUxWQURPUiAwMTIzOSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIktpYXJhMDkxODk4NjEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJIYXJ1dG85NjU4NyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIktheXplbkNoMjEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJCaWxpZUVsaXNoaCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkhhbnp6IHggcHZwIDEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJHd2VqS3JpbWluYWwiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNaGFhTWNEIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQWRtaW5Eb21pbm8iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSSVNLSSBQVVRSQUEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTZXlhIGdhbWVyNjc3NyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIklWIEFFU0lSMTAyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSjRNVVJLRVIzTiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkNsb3ZlclNhcGlrIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwicmVoYW45MDAxMjMiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJGcnV4eXk2NjYiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSYXh4enl5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUm5zIGdyb2NrIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiQWJkYW4yNTAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJUQUJPQlNLSSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFxdSBhV2Fubm5ubiI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlphZHJpY2UiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJwcm94aW1hIElWSSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJ0Z3JvY2s5OSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkRheWF0MDEwMSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJ5YW54YWthMDUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTb2Vzb2Vtb2UiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJHb2RzIGlzIGJhY2siOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJFaWR5czE4Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTEFMQSBFWENIQU5HRSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk51cndhbnRvIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2hpbno3NyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkFMQU0gSU5ETzk4MyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkJBTkRBUk1BREFOSSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkRpdHRYUSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1hb3UgU2FtYTQ0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVGFrYVNhbmRoaWthIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwieWVuZ2cga3lhIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU29yYTczMTEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJEaWthc3lhaCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlpYQ0JBTkFOQTQ0OTMiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunpIifX0sImFjaGVsU2t5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUG9pbnR5S25vdDEyMDI0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSW16ZXRzc3MiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNZWxmaXNzYWNoYW4iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJTaGFreUZlYXRoZXI1NTgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJCaWx6IDA1NSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJpc2thY2hhbkgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJLaW1uaWlpIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVmFueHV0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSGFzaGlCSTY5Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiWm9uYWxCYWtlcjg0NDYwIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVHJhYVN3b3JkIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2zIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6dsyJ9fSwiSWphbnNoYWRvdzk4MjIiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSaXlvbmFhYSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlRvcmV0dG8zNDUiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNYXJpYWltdXAiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJMb3NlckNyYWZ0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU3ByaW5nQmVkcyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1jZGhvcCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlJhbnNzMDEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJSaW43MTYzIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUmFpZGVuU2hvZ3VuOTA0Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiU2lBbHlzc2EiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJNdWVtZWtIdWl0YW0iOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJBbHBpbm5uNGsiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJCYWtzb2Jha2FyNzc1MyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk5DcmFmdEdhbWluZyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlN0YXJzUGl4aWVlIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiSW5keTI5MyI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlRIIEZhaXoxMTA2Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUmFqYSB3aWJ1MzE2NSI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIkNpYWNlYm9sIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiUGFrRGUxMTQ3Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTWxLS09PTyI6eyJpbmdhbWUiOnt9LCJjaGF0Ijp7Im5hbWV0YWciOiLunqoifX0sIktpa2l3TWlsa3kiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJpbWFkbGFjaG93c2tpIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiVmFsbGVuMzQ0OCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIk1hYWx5a2N3Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0IjpudWxsLCJwb3NpdGlvbiI6ImFib3ZlIn19fSwiTmFzaWt1bmluZzciOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOm51bGwsInBvc2l0aW9uIjoiYWJvdmUifX19LCJLaGFuYXRhYXp5cm90aCI6eyJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6bnVsbCwicG9zaXRpb24iOiJhYm92ZSJ9fX0sIlNlaUFwdCI6eyJjaGF0Ijp7fX0sIlNQRUNJQUxGMFJDRTEwMCI6eyJjaGF0Ijp7InRpdGxlIjoi7p2bIn19LCJSaXh4eSBWIjp7ImNoYXQiOnsidGl0bGUiOiLunZEiLCJuYW1ldGFnIjoi7p2gIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2gIn19LCJNb3JnYW5vYzI5MzMiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6dkSJ9fSwiVnlhbnp6QUkiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6dnyJ9fSwiQWx2YXJvIFN0dm4iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fiyJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6ekSIsInRpdGxlIjp7InRleHQiOiLunpQiLCJwb3NpdGlvbiI6InRvcCJ9fX0sIk1JTE9PSCI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunaIifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunaIifX0sIkJVTUkgSFlUQU0iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6doyJ9fSwiUVVFTk42MjIyOCI6eyJpbmdhbWUiOnt9fSwiRGFubnVyU3VraSI6eyJjaGF0Ijp7InRpdGxlIjoi7p2kIn19LCJhbnRpc3Bpb242NTQ0Ijp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2pIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6dqSJ9fSwiU2hhZGVBbmtCYWlrIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p2sIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6drCJ9fSwiTWlrYXNhNTkzMCI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6dqyJ9fSwiTG92YU5vb25hIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6hIiwidGl0bGUiOnsidGV4dCI6Iu6eoiIsInBvc2l0aW9uIjoidG9wIn19LCJjaGF0Ijp7Im5hbWV0YWciOiLunqEiLCJ0aXRsZSI6Iu6eoiJ9fSwiS2FubmFUYW1hY2hpaWkiOnsiY2hhdCI6eyJ0aXRsZSI6IsKnNFhSYXllcsKnZiJ9fSwiWWFuU2hlbGJ5Ijp7ImNoYXQiOnsidGl0bGUiOiLunYUifX0sIlZ5YW56ekFpIjp7ImNoYXQiOnsidGl0bGUiOiLunZ8ifX0sIkl0c2lsbHljaGlrbyI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6dtCIsInRpdGxlIjp7InRleHQiOiLuna4iLCJwb3NpdGlvbiI6InRvcCJ9fSwiY2hhdCI6eyJuYW1ldGFnIjoi7p20IiwidGl0bGUiOiLuna4ifX0sIkZhdGFoQ2lrdXIiOnsiY2hhdCI6e319LCJyb3NlbGx5bmFhIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p22IFxcbiDunL8iLCJwb3NpdGlvbiI6InRvcCJ9fX0sIkFsZG9kb2xzcyI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6duCJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunbgiLCJ0aXRsZSI6Iu6fgSJ9fSwiSGFuWmFyTUMyMDEwIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p25IiwicG9zaXRpb24iOiJiZWxvdyJ9fX0sIld5bW54RCI6eyJpbmdhbWUiOnt9fSwiV3ZlcnJyIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p25IiwicG9zaXRpb24iOiJiZWxvdyJ9LCJuYW1ldGFnIjoi7p6MIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6ejCJ9fSwiVHpvb3BNYyI6eyJjaGF0Ijp7InRpdGxlIjoi7p27IiwibmFtZXRhZyI6Iu6dvCJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6duyIsInBvc2l0aW9uIjoiYmVsb3cifSwibmFtZXRhZyI6Iu6dvCJ9fSwiQmVnaXZ2TUMiOnsiY2hhdCI6eyJ0aXRsZSI6IsKnNFhSYXllcsKnaSJ9fSwicml5eXlDaGkiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p64IiwidGl0bGUiOiLun4QifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunrgifX0sIlNOSVBFUlBSTEZlIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6dviJ9fSwiU05JUEVSUFJPRmUiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunb4ifSwiY2hhdCI6eyJuYW1ldGFnIjoi7p2+In19LCJZQUhIIENVUFUiOnsiY2hhdCI6eyJ0aXRsZSI6IsKnNFhyYXllcsKnciJ9fSwiUHJveGltYUNUVSI6eyJjaGF0Ijp7InRpdGxlIjoiwqc0WHJheWVywqdyIn19LCJrYXlsYWFhMjkyMiI6eyJjaGF0Ijp7InRpdGxlIjoiwqc0WHJheWVywqdyIn19LCJMRURJWDQ2MjIiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6ehCJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6ehCIsInBvc2l0aW9uIjoidG9wIn19fSwiRGlpa2tvb2xsbCI6eyJjaGF0Ijp7InRpdGxlIjoi7p6CIn0sImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6CIiwicG9zaXRpb24iOiJ0b3AifX19LCJMZW9uaGFydCBCRU4iOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p6BIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6BIn19LCJDaGxvb25hYSI6eyJjaGF0Ijp7InRpdGxlIjoi7p6CIn19LCJMaXR0bGUgY2lodXkiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6egCJ9fSwiQnVzZXRicm8gQm9zIjp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6AIiwicG9zaXRpb24iOiJ0b3AifX0sImNoYXQiOnsidGl0bGUiOiLunoAifX0sIklsaGFtSG5maSI6eyJjaGF0Ijp7InRpdGxlIjoi7p6HIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6GIn19LCJBZXJvbnNoaWt5eSI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunokiLCJ0aXRsZSI6Iu6fjSJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6eiSIsInRpdGxlIjp7InRleHQiOiLunpgiLCJwb3NpdGlvbiI6InRvcCJ9fX0sIlNsZWVweU1pdGExNTkwIjp7ImNoYXQiOnsidGl0bGUiOiLCpzRYcmF5ZXLCp3IifX0sImthcmFTU1IiOnsiY2hhdCI6eyJ0aXRsZSI6IsKnNFhyYXllcsKnciJ9fSwiTWlzdGFrZVpheW4iOnsiY2hhdCI6eyJ0aXRsZSI6IsKnNFhyYXllcsKnciJ9fSwiQmVnaXZ2TWMiOnsiY2hhdCI6eyJ0aXRsZSI6IsKnNFhyYXllcsKnciJ9fSwiQm9iYjA1MDgiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p6PIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6PIn19LCJGaW9vMjZLVCI6eyJjaGF0Ijp7Im5hbWV0YWciOiLuno0iLCJ0aXRsZSI6Iu6fgSJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6ejSIsInRpdGxlIjp7InRleHQiOiLunIUiLCJwb3NpdGlvbiI6InRvcCJ9fX0sInBhaHJpIHBhcmtlciI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6ejiJ9fSwiRGlsYWExMjgyNDMiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunpAifSwiY2hhdCI6eyJ0aXRsZSI6Iu6fgSJ9fSwiUXVlZW4gSnVpdGFhIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6TIiwidGl0bGUiOnsidGV4dCI6Iu6dhSIsInBvc2l0aW9uIjoidG9wIn19LCJjaGF0Ijp7Im5hbWV0YWciOiLunpMiLCJ0aXRsZSI6Iu6dhSJ9fSwiUmF1RmlDaGVsbCI6eyJjaGF0Ijp7InRpdGxlIjoi7p+LIiwibmFtZXRhZyI6Iu6epSJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6epSIsInRpdGxlIjp7InRleHQiOiLun48iLCJwb3NpdGlvbiI6InRvcCJ9fX0sIlBvb2tpcmFhIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6elyIsInRpdGxlIjoi7p+NIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6XIiwidGl0bGUiOnsidGV4dCI6Iu6elCIsInBvc2l0aW9uIjoidG9wIn19fSwiaWx5Y2hseiI6eyJjaGF0Ijp7InRpdGxlIjoi7p6UIiwibmFtZXRhZyI6Iu6epCJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6epCJ9fSwiZHV2ZXNzYTUxNTkiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6elCJ9fSwiS2VpaWthbm4iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fjSIsIm5hbWV0YWciOiLunp8ifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunp8ifX0sIldlc2l3ZXNpaWlsb2RhbSI6eyJjaGF0Ijp7InRpdGxlIjoi7p6UIn19LCJKdXN0VmVsb3VzcyI6eyJjaGF0Ijp7InRpdGxlIjoi7p6VIn19LCJLYXJpZGVhIjp7ImNoYXQiOnsidGl0bGUiOiLun4sifX0sIlp5dXUyMDEwIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6cIiwidGl0bGUiOnsidGV4dCI6Iu6duSIsInBvc2l0aW9uIjoiYmVsb3cifX0sImNoYXQiOnsibmFtZXRhZyI6Iu6enCIsInRpdGxlIjoi7p6dIn19LCJGYWxjb1h4eSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6eniJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunp4ifX0sInppbmN5Y2FuMjUiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLunqMifSwiY2hhdCI6eyJuYW1ldGFnIjoi7p6jIn19LCJMdXRoZmlNMjY5Ijp7ImNoYXQiOnsidGl0bGUiOiLun4siLCJuYW1ldGFnIjoi7p6mIn19LCJMdXRmZmlNMjY5Ijp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6mIn19LCJZdWlBaXphd2FhIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6epyJ9fSwiYWJkZHh2Ijp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6rIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6eqyIsInRpdGxlIjoi7p+BIn19LCJSaWVubmFTRiI6eyJpbmdhbWUiOnt9LCJjaGF0Ijp7Im5hbWV0YWciOiLunq0iLCJ0aXRsZSI6Iu6egCJ9fSwiTmVidWxsYXV1Ijp7ImNoYXQiOnsidGl0bGUiOiLunoIifX0sIll1ZGhhTUMxOTI4Ijp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6uIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6eriJ9fSwiVmVsaHVhYWFhYSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6eryJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLunq8iLCJ0aXRsZSI6Iu6elCJ9fSwiaWt1dXJhYWEiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLunrAiLCJwb3NpdGlvbiI6InRvcCJ9LCJuYW1ldGFnIjoi7p+QIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6esCIsInRpdGxlIjoi7p+NIn19LCJQaGlsbG94ZW5vbnowODAiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fiyJ9fSwiUmFGRlVyaWluZVh0Ijp7ImNoYXQiOnsidGl0bGUiOiLunpQifX0sIlNreTY3MTkwIjp7ImNoYXQiOnsidGl0bGUiOiLunpQifX0sIlJpemNoYXJ0ZW56eiI6eyJjaGF0Ijp7InRpdGxlIjoi7p+NIiwibmFtZXRhZyI6Iu6fjiJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6fjiJ9fSwiV2VzaXdlc2lpaWloZCI6eyJjaGF0Ijp7InRpdGxlIjoi7p+LIiwibmFtZXRhZyI6Iu6fgiJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6fgiJ9fSwiV2hpdG5leW5lZSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+MIn19LCJGNGhhamFyIjp7ImNoYXQiOnsidGl0bGUiOiLun4sifX0sIlJhZnRpeEt1biI6eyJjaGF0Ijp7InRpdGxlIjoi7p6UIn19LCJMeWthaW5hbHkiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fjCJ9fSwiS2VpaXNoYWFhYWFhIjp7ImNoYXQiOnsidGl0bGUiOiLun4wifX0sIlNyeW5vdSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+LIn19LCJaYXJhaW11bmkiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fjCJ9fSwiSGVybGluYXciOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fiyIsIm5hbWV0YWciOiLunrcifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunrcifX0sIkFyZmFjaEFpMDgiOnsiaW5nYW1lIjp7InRpdGxlIjp7InRleHQiOiLun4UiLCJwb3NpdGlvbiI6InRvcCJ9LCJuYW1ldGFnIjoi7p62In0sImNoYXQiOnsidGl0bGUiOiLun4UiLCJuYW1ldGFnIjoi7p62In19LCJJdGFzeWFhIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6xIn0sImNoYXQiOnsibmFtZXRhZyI6Iu6esSJ9fSwiUnl1ODY3MSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6esiJ9fSwicmluWnogdG1wYW4iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6esyJ9fSwiTENyYWZ0NjExMyI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJGbG96eUhlYVQiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6esyJ9fSwic3RhcndhcnM5NjYwIjp7ImNoYXQiOnsidGl0bGUiOiLunrMifX0sIkFzc2F1bHRSd3B0b3JyIjp7ImNoYXQiOnsidGl0bGUiOiLunrMifX0sIk1ld29mZmljaWFsNTAxOCI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJQcmF6ektvbmpldCI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJOVU5BdGljIE1vb24iOnsiY2hhdCI6eyJ0aXRsZSI6Iu6esyIsIm5hbWV0YWciOiLunqEifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunqEifX0sIkxvcml6IFRlYXoiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6esyJ9fSwiaXRzbWV0YWJvYiI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJIYW5hblRhbXBhbiI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJMZW9QcmluY2VlZSI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJBbmRyYTM1ODYiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6esyJ9fSwibW9uZGVjazk3Ijp7ImNoYXQiOnsidGl0bGUiOiLunrMifX0sIkFydGVtaXMgR29mdyI6eyJjaGF0Ijp7InRpdGxlIjoi7p+MIiwibmFtZXRhZyI6Iu6euyJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6euyJ9fSwiUGluayBGbGFzaDIzMjQiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6elCJ9fSwibGx5b2RwaSI6eyJjaGF0Ijp7InRpdGxlIjoi7p6zIn19LCJCaWdTb3NpczI2NyI6eyJjaGF0Ijp7InRpdGxlIjoi7p+MIiwibmFtZXRhZyI6Iu6fgyJ9LCJpbmdhbWUiOnsidGl0bGUiOnsidGV4dCI6Iu6elCIsInBvc2l0aW9uIjoidG9wIn19fSwiQ3liZXI2NjU3Ijp7ImluZ2FtZSI6eyJ0aXRsZSI6eyJ0ZXh0Ijoi7p6zIiwicG9zaXRpb24iOiJ0b3AifX0sImNoYXQiOnsidGl0bGUiOiLunrMifX0sIkNsYXJhMjYxNyI6eyJjaGF0Ijp7InRpdGxlIjoi7p+MIn19LCJsdHNSdW1iYWgiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6elCJ9fSwiSXRzUnVtYmFoIjp7ImNoYXQiOnsidGl0bGUiOiLun4wifX0sIlJpeXl5Q2hpIjp7ImluZ2FtZSI6e319LCJhYmNkemFpbiI6eyJpbmdhbWUiOnt9LCJjaGF0Ijp7Im5hbWV0YWciOiLunrkifX0sIlRpbm55QnVzNjgwMSI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunr0iLCJ0aXRsZSI6Iu6elCJ9LCJpbmdhbWUiOnsibmFtZXRhZyI6Iu6evSJ9fSwiTWlzdGFrZSBNaWtvIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6+In19LCJlcnJmYWUiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p6/In0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p6/In19LCJSYWZsZWhoaGhoIjp7ImluZ2FtZSI6eyJuYW1ldGFnIjoi7p+AIn19LCJQaW9ueXRlMTIxNCI6eyJjaGF0Ijp7InRpdGxlIjoi7p+BIn19LCJyaXJpZGgiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fgSJ9fSwiSGFrdWJhYTAxIjp7ImNoYXQiOnsidGl0bGUiOiLun4sifX0sIkZhZGhlbGtmIjp7ImNoYXQiOnsidGl0bGUiOiLun4EifX0sIktpZ28yNjAxIjp7ImNoYXQiOnsidGl0bGUiOiLun4EifX0sInNheXJlbm5hYSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+BIn19LCJ5dW1taWF3Ijp7ImNoYXQiOnsidGl0bGUiOiLun4EifX0sIlpvdSBSeXV1aGVpaSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+BIn19LCJBbGRvZG9sZXMiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fgSJ9fSwiQWxscDI4MDQiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fgSJ9fSwiU2FtIEdhbnRlbmcxODUxIjp7ImNoYXQiOnsidGl0bGUiOiLun4QifX0sIk5leHVzNzAxNDM1OSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+NIn19LCJncmljY2VlIjp7ImNoYXQiOnsidGl0bGUiOiLun4QiLCJuYW1ldGFnIjoi7p+GIn0sImluZ2FtZSI6eyJuYW1ldGFnIjoi7p+GIn19LCJSb3loYW1hODU4NyI6eyJjaGF0Ijp7fX0sIkF6aXNzNTQ1MSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+FIn19LCJtb290ZWVibHVlIjp7ImNoYXQiOnsidGl0bGUiOiLun4UifX0sIkF6aXNzNTQxNSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+FIn19LCJLUlVHRVIzNzg3Ijp7ImNoYXQiOnsidGl0bGUiOiLun4UifX0sIkNoaWVyeW5uIjp7ImNoYXQiOnsibmFtZXRhZyI6Iu6fhyIsInRpdGxlIjoi7p6AIn19LCJTYWNoaU5ld2JpZWUiOnsiY2hhdCI6eyJuYW1ldGFnIjoi7p+IIn19LCJsaXR0bGVIdWlpSHVpaSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6Iu6fiSJ9LCJjaGF0Ijp7Im5hbWV0YWciOiLun4kiLCJ0aXRsZSI6Iu6egCJ9fSwiWmF5czYwMjkiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fiyJ9fSwiRmVybmFuZGV6enp6MzAwIjp7ImluZ2FtZSI6e30sImNoYXQiOnsibmFtZXRhZyI6Iu6fiiJ9fSwiSWt1cmFhYSI6eyJjaGF0Ijp7fX0sImlrdXJhYWEiOnsiY2hhdCI6e319LCJSaXNjaGFydGVuenoiOnsiaW5nYW1lIjp7Im5hbWV0YWciOiLun44ifX0sIktlaWlpa2FubiI6eyJjaGF0Ijp7InRpdGxlIjoi7p+NIn19LCJ3ZXNpd2VzaWlpaWhkIjp7ImNoYXQiOnsidGl0bGUiOiLun4sifX0sIlJhRkZicmVlemUiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fiyJ9fSwiS2Vpc2hhYWEiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fjCJ9fSwiWXV0YWVsYTI1Ijp7ImNoYXQiOnsidGl0bGUiOiLun4wifX0sIktvdG93YXJ1MiI6eyJjaGF0Ijp7fX0sIlJhRkZCcmVlemUiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fiyJ9fSwiUmhpbm4zMTc1Ijp7ImNoYXQiOnsidGl0bGUiOiLunoAifX0sIkNBQkUgWUVBR0VSOTYxNiI6eyJjaGF0Ijp7InRpdGxlIjoi7p+FIn19LCJSaWthIFBsZW5nZXIiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6fkyJ9fSwiVmVyYWFPbmx5eSI6eyJjaGF0Ijp7InRpdGxlIjoi7p+LIn19LCJkYW50ZWNrOTEwMSI6eyJpbmdhbWUiOnsibmFtZXRhZyI6IlsgQk9UIF0ifX0sIm1hbno0OTM5Ijp7ImNoYXQiOnt9fSwibFRhc3lhYSI6eyJjaGF0Ijp7Im5hbWV0YWciOiLunrEifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLunrEifX0sIk1hcyBMaWZ6MTU3MCI6eyJjaGF0Ijp7InRpdGxlIjoi7p+UIn19LCJLaXpTYW5kd2ljaCI6eyJjaGF0Ijp7InRpdGxlIjoi7p+UIn19LCJNYWtvdG9BaXplbjIzNTQiOnsiY2hhdCI6eyJ0aXRsZSI6Iu6flCIsIm5hbWV0YWciOiLun5UifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLun5UifX0sIlJhbiBDaWh1dXV5Ijp7ImNoYXQiOnsidGl0bGUiOiLun5QifX0sIkNoZXJ5eXlsbCI6eyJjaGF0Ijp7Im5hbWV0YWciOiLun5YifSwiaW5nYW1lIjp7Im5hbWV0YWciOiLun5YifX19"

// Helper function to read chunked data
function readChunkedProperty(baseKey) {
    const chunkCountStr = world.getDynamicProperty(`${baseKey}:c0`);

    if (chunkCountStr !== undefined) {
        // Chunked format
        try {
            const chunkCount = parseInt(chunkCountStr);
            let fullStr = "";
            for (let i = 1; i <= chunkCount; i++) {
                const chunk = world.getDynamicProperty(`${baseKey}:c${i}`);
                if (chunk === undefined) break;
                fullStr += chunk;
            }
            return JSON.parse(fullStr);
        } catch (e) {
            console.warn(`Failed to read chunks for ${baseKey}:`, e);
        }
    }

    // Fallback to single property (old format or small data)
    const single = world.getDynamicProperty(baseKey);
    if (single !== undefined) {
        try {
            return JSON.parse(single);
        } catch {
            return single;
        }
    }

    return null;
}

// Helper function to write chunked data
function writeChunkedProperty(baseKey, value) {
    const CHUNK_SIZE = 28000;
    const jsonStr = JSON.stringify(value);

    // Clear old data first
    world.setDynamicProperty(baseKey, undefined);
    for (let i = 0; i <= 100; i++) {
        world.setDynamicProperty(`${baseKey}:c${i}`, undefined);
    }

    if (jsonStr.length <= CHUNK_SIZE) {
        // Single chunk
        world.setDynamicProperty(baseKey, jsonStr);
    } else {
        // Multiple chunks
        const chunks = [];
        for (let i = 0; i < jsonStr.length; i += CHUNK_SIZE) {
            chunks.push(jsonStr.slice(i, i + CHUNK_SIZE));
        }

        // c0 = chunk count
        world.setDynamicProperty(`${baseKey}:c0`, chunks.length.toString());
        chunks.forEach((chunk, i) => {
            world.setDynamicProperty(`${baseKey}:c${i + 1}`, chunk);
        });
    }
}

// Export handler
system.afterEvents.scriptEventReceive.subscribe((event) => {
    if (event.id === "mimi:export_customizations") {
        world.sendMessage("§aExporting customizations...");

        // Read customizations using chunked format
        const customizations = readChunkedProperty("player:customizations");

        if (customizations) {
            const base64Data = base64.encode(JSON.stringify(customizations));
            console.warn("=== Customizations Export Data ===");
            console.warn(base64Data);
            console.warn("=== End of Export Data ===");
            console.warn("=== Debug: Original Data ===");
            // console.warn(JSON.stringify(customizations, null, 2));
            console.warn("=== End Debug ===");
            console.warn("To import: Replace importCustomizationsData value with this string");
            world.sendMessage("§aExport complete! Check content log for base64 data.");
        } else {
            console.warn("No customizations data found!");
            world.sendMessage("§cNo customizations data found!");
        }
    }
});

// Import handler
if (importCustomizationsData) {
    try {
        console.warn("=== Debug: Starting Import Process ===");

        // Base64 decode
        const decodedString = base64.decode(importCustomizationsData);
        console.warn("Step 1 - Base64 decoded length: " + decodedString.length);

        // Parse JSON
        const customizations = JSON.parse(decodedString);

        console.warn("=== Debug: Decoded Data ===");
        console.warn(JSON.stringify(customizations, null, 2));
        console.warn("=== End Debug ===");

        // Apply using chunked format
        system.run(() => {
            writeChunkedProperty("player:customizations", customizations);
            // Cache-invalidate: direct DP write bypasses DB.set(), so flush manually
            playerDB._invalidateCust();
            console.warn("Customizations imported successfully with chunked storage!");
        });

    } catch (error) {
        console.warn("=== Debug: Import Error ===");
        console.warn("Error type: " + error.name);
        console.warn("Error message: " + error.message);
        console.warn("=== End Debug ===");
    }
}