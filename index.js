require("dotenv").config();
const fs = require("fs");
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActivityType 
} = require("discord.js");
const { fetch } = require("undici");
const xml2js = require("xml2js");

// =======================
// DISCORD CLIENT
// =======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =======================
// FILE PATHS
// =======================
const LAST_VIDEO_FILE = "./last_video.json";
const STOPPED_USERS_FILE = "./stopped_users.json";
const NOTIFIED_USERS_FILE = "./notified_users.json";

// =======================
// JSON HELPERS
// =======================
function readJSON(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
        return fallback;
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// =======================
// YOUTUBE CONFIG
// =======================
const CHANNEL_ID = "UC9exOhASNX9iN1GpLUiwLTQ";
const CHANNEL_URL = "https://www.youtube.com/@RuDyy_val";
const RSS_FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

// =======================
// STATUS ROTATION STATE
// =======================
let latestVideoTitle = "YouTube Updates";
let latestVideoUrl = CHANNEL_URL;
let statusRotation = [];
let rotationIndex = 0;

// =======================
// FETCH LATEST VIDEO
// =======================
async function fetchLatestVideo() {
    try {
        const res = await fetch(RSS_FEED);
        const xml = await res.text();
        const parsed = await xml2js.parseStringPromise(xml);

        const entry = parsed?.feed?.entry?.[0];
        if (!entry) return;

        const videoId = entry["yt:videoId"][0];
        const videoUrl = entry.link[0].$.href;
        const title = entry.title[0];
        const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

        latestVideoTitle = title.substring(0, 60);
        latestVideoUrl = videoUrl;
        buildStatusRotation();

        const state = readJSON(LAST_VIDEO_FILE, { lastVideoId: "" });
        if (state.lastVideoId === videoId) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0xff0000)
            .setImage(thumbnail)
            .setTimestamp();

        await notifyUsers(videoUrl, embed);

        writeJSON(LAST_VIDEO_FILE, { lastVideoId: videoId });
        console.log("📩 New video sent");

    } catch (err) {
        console.log("❌ RSS error:", err.message);
    }
}

// =======================
// SEND DM (TAG + LINK + EMBED)
// =======================
async function notifyUsers(videoUrl, embed) {
    const stoppedUsers = readJSON(STOPPED_USERS_FILE, []);
    const notifiedUsers = readJSON(NOTIFIED_USERS_FILE, []);

    for (const [, guild] of client.guilds.cache) {
        const role = guild.roles.cache.get(process.env.ALERT_ROLE_ID);
        if (!role) continue;

        await guild.members.fetch();

        for (const [, member] of role.members) {
            if (stoppedUsers.includes(member.id)) continue;

            try {
                await member.send({
                    content: `<@${member.id}>\n${videoUrl}`,
                    embeds: [embed]
                });

                if (!notifiedUsers.includes(member.id)) {
                    notifiedUsers.push(member.id);
                }
            } catch {
                // DM closed or blocked → ignore
            }
        }
    }

    writeJSON(NOTIFIED_USERS_FILE, notifiedUsers);
}

// =======================
// DM COMMANDS
// =======================
client.on("messageCreate", async (message) => {
    if (!message.channel.isDMBased()) return;
    if (message.author.bot) return;

    const text = message.content.toLowerCase().trim();

    // STOP
    if (text === "stop" || text === "/stop") {
        const stopped = readJSON(STOPPED_USERS_FILE, []);
        if (!stopped.includes(message.author.id)) {
            stopped.push(message.author.id);
            writeJSON(STOPPED_USERS_FILE, stopped);
        }
        await message.reply("❌ You are unsubscribed.");
    }

    // START
    if (text === "/start") {
        let stopped = readJSON(STOPPED_USERS_FILE, []);
        stopped = stopped.filter(id => id !== message.author.id);
        writeJSON(STOPPED_USERS_FILE, stopped);
        await message.reply("✅ You are subscribed again.");
    }
});

// =======================
// STATUS ROTATION
// =======================
function buildStatusRotation() {
    statusRotation = [
        { name: latestVideoTitle, url: latestVideoUrl },
        { name: "RuDyy YouTube Channel", url: CHANNEL_URL },
        { name: "Subscribers: 1.80K", url: CHANNEL_URL },
        { name: "Created by vatsa.7760", url: "https://srivatsamg.netlify.app/" }
    ];
}

function rotateStatus() {
    if (!statusRotation.length) return;

    const current = statusRotation[rotationIndex];

    client.user.setPresence({
        status: "online",
        activities: [{
            name: current.name,
            type: ActivityType.Streaming,
            url: current.url
        }]
    });

    rotationIndex = (rotationIndex + 1) % statusRotation.length;
}

// =======================
// READY
// =======================
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    await fetchLatestVideo();
    buildStatusRotation();
    rotateStatus();

    setInterval(fetchLatestVideo, 5 * 60 * 1000); // check uploads
    setInterval(rotateStatus, 7 * 1000);          // rotate status
});

client.login(process.env.DISCORD_TOKEN);