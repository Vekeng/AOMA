import { commands } from './commands.js'; 
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import fetch from 'node-fetch';
import fs from 'fs';
import { Client, GatewayIntentBits, Options, REST, Routes, SlashCommandBuilder } from 'discord.js';




const db = new sqlite3.Database('./alerts.db');
const items = JSON.parse(fs.readFileSync('items.json', 'utf8'));

const items_map = items
    .map(item => {
        const item_id = item.UniqueName;
        const item_name = item.LocalizedNames;

        if (!item_name || !item_name["EN-US"]) {
        return null;
        }

        let itemName = item_name["EN-US"]; 
        let itemLevel = "";

        const match = item_id.match(/^T(\d+)_/); 
        if (match) {
        itemLevel = match[1]; 
        }

        const enchantmentMatch = item_id.match(/@(\d)$/);
        if (enchantmentMatch) {
        itemLevel += `.${enchantmentMatch[1]}`; 
        }

        const name_with_tier = `${itemName} ${itemLevel}`;
        return { name_with_tier, item_id };
    })
    .filter(item => item !== null); 

const qualityMap = {
    1: "Normal",
    2: "Good",
    3: "Outstanding",
    4: "Excellent",
    5: "Masterpiece"
};

// Create Alerts table if not exists
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_quality TEXT NOT NULL,
            item_name TEXT NOT NULL,
            price_threshold REAL NOT NULL,
            direction TEXT CHECK(direction IN ('higher', 'lower')) NOT NULL
        )
    `);
});

// Load .env params 
dotenv.config();

// initializing discordjs stuff
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Register slash commands
(async () => {
    try {
        console.log('Refreshing slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID), 
            { body: commands }
        );
        console.log('Slash commands registered.');
    } catch (error) {
        console.error(error);
    }
})();

// Handle interactions
client.on('interactionCreate', async (interaction) => {
    // Autocompletion
    if (interaction.isAutocomplete()) {
        if (interaction.commandName === 'add') {
  
            const focused_value = interaction.options.getFocused();
            const filtered_items = items_map.filter(item => 
                item.name_with_tier.toLowerCase().includes(focused_value.toLowerCase())
              );
              await interaction.respond(
                filtered_items.slice(0, 25).map(item => ({
                  name: item.name_with_tier, 
                  value: item.item_id // 
                }))
              );
        }
    }
    // Now we track only commands
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'list') {
        const alerts = await getUserAlerts(interaction.user.id);
        if (alerts.length === 0) {
            return await interaction.reply({content: `You have no active alerts!`, ephemeral: true});
        } 
        const message = alerts.map((alert, index) => 
            `${index + 1}. ${qualityMap[alert.item_quality] || "Unknown"} **${alert.item_name}**, if price ${alert.direction === 'higher' ? '📈 above' : '📉 below'} ${alert.price_threshold}.`
        ).join("\n");
        return await interaction.reply({content:`🔔 **Your active alerts**\n${message}`, ephemeral: true});
    } else if (interaction.commandName === 'add') {
        
        const item_id = interaction.options.getString('item');
        const item_quality = interaction.options.getString('quality');
        const threshold = interaction.options.getString('threshold');
        const direction = interaction.options.getString('direction');
        const selected_item = items_map.find(item => item.item_id === item_id);
        let item_name;
        if (selected_item) {
            item_name = selected_item.name_with_tier;
            console.log(selected_item);
        } else {
            return await interaction.reply({content: `Item **${item_id}** this name doesn't exist`, ephemeral: true});
        }
        insertAlert(interaction.user.id, item_id, item_name, item_quality, threshold, direction);

        await interaction.reply({content: `Watching for ${qualityMap[item_quality] || "Unknown"} ${selected_item.name_with_tier} to go ${direction === 'higher' ? '📈 above' : '📉 below'} than ${threshold}`, ephemeral: true});
    } else if (interaction.commandName === 'delete') {
        await interaction.reply({content: `Alert deleted!`, ephemeral: true});
    }
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    setInterval(async () => {await checkAlerts(client)}, 5 * 60 * 1000); 

});

client.login(process.env.DISCORD_TOKEN);

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed.');
        }
    });
    client.destroy();
    process.exit();
});

const insertAlert = (user, item_id, item_name, item_quality, threshold, direction) => {
    const sql = `
        INSERT INTO alerts (user_id, item_id, item_name, item_quality, price_threshold, direction)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(sql, [user, item_id, item_name, item_quality, threshold, direction], function(err) {
        if (err) {
            console.error('Error inserting data:', err);
            return;
        }
        console.log(`Alert inserted with ID: ${this.lastID}`);
    });
};

const getUserAlerts = async (user_id) => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM alerts WHERE user_id = ?';
        db.all(sql, [user_id], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
};


async function fetchMarketData(items_string) {
    try {
        const response = await fetch(`https://europe.albion-online-data.com/api/v2/stats/prices/${items_string}`); 
        const data = await response.json();
        return data;  
    } catch (err) {
        console.error('Error fetching market data:', err);
        return null;
    }
}

async function checkAlerts(client) {
    console.log("Checking alerts!")
    const item_rows = await getDistinctItems();
    const item_string = item_rows.map(item => item.item_id).join(",");
    const data = await fetchMarketData(item_string);
    const alerts = await getAllAlerts();

    alerts.forEach(async alert => {  
        let cityAlerts = {}; 
        const matching_items = data.filter(item => item.item_id === alert.item_id && String(item.quality) === String(alert.item_quality));

        matching_items.forEach(match => {
            const trigger = (alert.direction === "higher" && alert.price_threshold < match.sell_price_min && match.sell_price_min !== 0 && match.sell_price_min !== match.sell_price_max) || 
            (alert.direction === "lower" && alert.price_threshold > match.sell_price_min && match.sell_price_min !== 0 && match.sell_price_min !== match.sell_price_max); 
            
            if (trigger) {
                if (!cityAlerts[match.city]) {
                    cityAlerts[match.city] = [];
                }
                cityAlerts[match.city].push(match.sell_price_min); 
            }    
        });

        if (Object.keys(cityAlerts).length === 0) return; 

        // Build message
        let message = `📢 **Price Alert Triggered!**\n **${qualityMap[alert.item_quality] || "Unknown"} ${alert.item_name}**\n`;
        Object.entries(cityAlerts).forEach(([city, prices]) => {
            message += `🏰 **City:** ${city} - 📊 **Price:** ${Math.min(...prices)}\n`;
        });
        message += `📈 **Your Alert:** ${alert.direction} than ${alert.price_threshold}`;

        // Send DM to the user
        try {
            const user = await client.users.fetch(alert.user_id);
            if (user) {
                await user.send(message);
                console.log(`DM sent to user ${alert.user_id}`);
                deleteAlert(alert.id);
            }
        } catch (error) {
            console.error(`Failed to send DM to user ${alert.user_id}:`, error);
        }
    });
}

// Function to get distinct items to request them from API then
const getDistinctItems = async () => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT DISTINCT item_id FROM alerts';
        db.all(sql, [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
};

// Function to get all alerts
const getAllAlerts = async () => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM alerts';
        db.all(sql, [], (err, rows) => {
            if (err) reject(err);
            resolve(rows);
        });
    });
};

// Function to delete alert
const deleteAlert = async (id) => {
    return new Promise((resolve, reject) => {
        const sql = 'DELETE FROM alerts WHERE id = ?';
        db.run(sql, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes); 
            }
        });
    });
};