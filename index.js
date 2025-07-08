// index.js
require('dotenv').config();
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const express = require('express');
const cron = require('node-cron');

// Load environment variables
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 10000;

// Telegram bot
const bot = new TelegramBot(TG_TOKEN);

// Express server
const app = express();
app.listen(PORT, () => {
  console.log(`✅ Listening on port ${PORT}`);
});

console.log("--- Env Variable Check ---");
console.log("HELIUS_API_KEY:", HELIUS_API_KEY ? "Present" : "Missing");
console.log("WALLET_ADDRESS:", WALLET_ADDRESS);
console.log("TG_TOKEN:", TG_TOKEN ? "Present" : "Missing");
console.log("TG_CHAT_ID:", TG_CHAT_ID ? "Present" : "Missing");
console.log("MONGODB_URI:", MONGODB_URI ? "Present" : "Missing");

// MongoDB setup
let db, alertedTokens;
MongoClient.connect(MONGODB_URI).then(client => {
  db = client.db();
  alertedTokens = db.collection("alertedTokens");
  console.log("📦 Connected to MongoDB.");
}).catch(err => console.error("❌ MongoDB Connection Error:", err));

// Helper to check if a token is already alerted
async function hasBeenAlerted(mint) {
  return !!(await alertedTokens.findOne({ mint }));
}

// Helper to save alerted token
async function saveAlertedToken(mint) {
  await alertedTokens.insertOne({ mint });
}

// Get token mint creation time from Helius
async function getMintCreationTime(mint) {
  try {
    const url = `https://api.helius.xyz/v0/tokens/${mint}/metadata?api-key=${HELIUS_API_KEY}`;
    const { data } = await axios.get(url);
    if (!data || !data.createdAt) return null;
    return Math.floor(new Date(data.createdAt).getTime() / 1000);
  } catch (e) {
    console.error(`❌ Error getting mint creation for ${mint}:`, e.message);
    return null;
  }
}

// Poll recent transactions every 5 minutes
cron.schedule("*/5 * * * *", async () => {
  console.log("⏱️ Checking for new sells...");
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&limit=20`;
    const { data: txs } = await axios.get(url);
    if (!txs || txs.length === 0) return;

    for (const tx of txs) {
      console.log(`🔍 Checking transaction ${tx.signature}`);

      const timestamp = tx.timestamp;
      const swap = tx.tokenTransfers?.find(t => t.fromUserAccount === WALLET_ADDRESS && t.tokenAmount?.amount > 0);
      if (!swap) continue;

      const mint = swap.mint;
      const already = await hasBeenAlerted(mint);
      if (already) {
        console.log(`⚠️ Already alerted for ${mint}, skipping.`);
        continue;
      }

      console.log(`💡 Found potential sell: ${tx.signature}`);
      console.log(`   Mint: ${mint}`);
      console.log(`   Timestamp: ${timestamp}`);

      const creationTime = await getMintCreationTime(mint);
      if (!creationTime) continue;

      console.log(`⏰ Mint ${mint} was created at ${creationTime}, now: ${timestamp}`);
      if ((timestamp - creationTime) <= 7200) {
        console.log(`📢 ALERT: First sell of new token within 2 hours! Mint: ${mint}`);
        const msg = `🚨 Token Sold!
Wallet: ${WALLET_ADDRESS}
Mint: ${mint}
Tx: https://solscan.io/tx/${tx.signature}`;
        await bot.sendMessage(TG_CHAT_ID, msg);
        await saveAlertedToken(mint);
      }
    }
  } catch (e) {
    console.error("❌ Error during polling:", e.message);
  }
});


