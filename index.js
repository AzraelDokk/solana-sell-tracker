require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

const {
  HELIUS_API_KEY,
  WALLET_ADDRESS,
  TG_TOKEN,
  TG_CHAT_ID,
  MONGODB_URI,
  PORT
} = process.env;

// Basic env check
console.log("--- Env Variable Check ---");
console.log("HELIUS_API_KEY:", HELIUS_API_KEY ? "Present" : "Missing");
console.log("WALLET_ADDRESS:", WALLET_ADDRESS);
console.log("TG_TOKEN:", TG_TOKEN ? "Present" : "Missing");
console.log("TG_CHAT_ID:", TG_CHAT_ID ? "Present" : "Missing");
console.log("MONGODB_URI:", MONGODB_URI ? "Present" : "Missing");

const bot = new TelegramBot(TG_TOKEN);
const API_URL = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&limit=50`;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('📦 Connected to MongoDB.'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

const tokenSchema = new mongoose.Schema({
  mint: String,
  alerted: Boolean,
  createdAt: Date
});
const Token = mongoose.model('Token', tokenSchema);

// === Get token creation time ===
async function getTokenCreationTime(mint) {
  try {
    const url = `https://api.helius.xyz/v0/tokens/${mint}/metadata?api-key=${HELIUS_API_KEY}`;
    const { data } = await axios.get(url);
    return new Date(data.onChainCollectionDetails?.createdAt || data.createdAt || 0);
  } catch (e) {
    console.error(`⚠️ Error fetching creation time for ${mint}:`, e.message);
    return null;
  }
}

// === Send Telegram Alert ===
async function sendAlert(mint) {
  const msg = `✅ First sell detected for new token:\n\n${mint}`;
  await bot.sendMessage(TG_CHAT_ID, msg);
  console.log(`✅ Alert sent for ${mint}`);
}

// === Check recent transactions every 5 minutes ===
async function checkForNewSells() {
  try {
    const { data } = await axios.get(API_URL);
    const txs = data.filter(tx => tx.type === 'SWAP');

    for (const tx of txs) {
      const mint = tx.tokenTransfers?.find(t => t.fromUserAccount === WALLET_ADDRESS)?.mint;
      if (!mint) continue;

      const exists = await Token.findOne({ mint });
      if (exists) {
        console.log(`⚠️ Already alerted for ${mint}, skipping.`);
        continue;
      }

      const creationTime = await getTokenCreationTime(mint);
      if (!creationTime) continue;

      const now = new Date();
      const ageInMs = now - creationTime;
      const twoHours = 2 * 60 * 60 * 1000;

      if (ageInMs <= twoHours) {
        await sendAlert(mint);
      } else {
        console.log(`⏱️ Sell for ${mint} ignored (older than 2h).`);
      }

      await Token.create({ mint, alerted: true, createdAt: now });
    }
  } catch (e) {
    console.error("❌ Error during check:", e.message);
  }
}

// === Run every 5 mins ===
cron.schedule('*/5 * * * *', checkForNewSells);

// Initial run
checkForNewSells();

const express = require('express');
const app = express();
app.get('/', (_, res) => res.send('✅ Solana Sell Tracker is live.'));
app.listen(PORT || 10000, () => {
  console.log(`✅ Listening on port ${PORT || 10000}`);
});


