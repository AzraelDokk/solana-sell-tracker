// === index.js ===
require('dotenv').config();
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const cron = require('node-cron');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

if (!HELIUS_API_KEY || !WALLET_ADDRESS || !TG_TOKEN || !TG_CHAT_ID || !MONGODB_URI) {
  console.error('❌ Missing one or more environment variables!');
  process.exit(1);
}

const heliusBaseUrl = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}`;
const tokenMetaUrl = (mint) => `https://api.helius.xyz/v0/mints/${mint}?api-key=${HELIUS_API_KEY}`;

const bot = new TelegramBot(TG_TOKEN, { polling: false });

let db, alertsCollection;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI, { family: 4 });
  await client.connect();
  db = client.db('solanaSellTracker');
  alertsCollection = db.collection('alerts');
  console.log('📦 Connected to MongoDB.');
}

async function hasAlreadyAlerted(tokenMint) {
  const record = await alertsCollection.findOne({ tokenMint });
  return !!record;
}

async function markAlerted(tokenMint) {
  await alertsCollection.insertOne({ tokenMint, alertedAt: new Date() });
}

async function getTokenCreationTimestamp(tokenMint) {
  try {
    const res = await fetch(tokenMetaUrl(tokenMint));
    if (!res.ok) return null;
    const data = await res.json();
    return data?.creationTime || null;
  } catch (error) {
    return null;
  }
}

async function checkForNewSells() {
  try {
    const res = await fetch(heliusBaseUrl);
    if (!res.ok) return;

    const transactions = await res.json();
    if (!Array.isArray(transactions)) return;

    for (const tx of transactions) {
      if (!tx.tokenTransfers || tx.tokenTransfers.length === 0) continue;

      const sells = tx.tokenTransfers.filter(tt => tt.fromUserAccount === WALLET_ADDRESS && tt.amount > 0);
      if (sells.length === 0) continue;

      for (const sell of sells) {
        const tokenMint = sell.mint;
        const alreadyAlerted = await hasAlreadyAlerted(tokenMint);
        if (alreadyAlerted) continue;

        const creationTime = await getTokenCreationTimestamp(tokenMint);
        if (!creationTime) continue;

        const creationDate = new Date(creationTime * 1000);
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        if (creationDate.getTime() < twoHoursAgo) continue;

        const message = `🚨 Token Sell Detected!\n\nToken Mint: ${tokenMint}\nCreated: ${creationDate.toLocaleString()}\nTransaction: https://explorer.solana.com/tx/${tx.signature}`;

        try {
          await bot.sendMessage(TG_CHAT_ID, message);
          await markAlerted(tokenMint);
        } catch (err) {
          console.error(`❌ Telegram error for token ${tokenMint}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error checking sells:', err);
  }
}

async function start() {
  await connectDB();
  await bot.sendMessage(TG_CHAT_ID, '🚨 Bot started and connected successfully.');
  await checkForNewSells();
  cron.schedule('*/5 * * * *', checkForNewSells);

  const port = process.env.PORT || 10000;
  require('http').createServer().listen(port, () => {
    console.log(`✅ Listening on port ${port}`);
  });
}

start();


// === webhook.js ===
require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const app = express();

const MONGODB_URI = process.env.MONGODB_URI;

let db, tokenCollection;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI, { family: 4 });
  await client.connect();
  db = client.db('solanaSellTracker');
  tokenCollection = db.collection('mintedTokens');
  console.log('📦 Webhook DB connected');
}

app.use(express.json());

app.post('/webhook', async (req, res) => {
  const event = req.body;
  if (!event || !event.events) return res.sendStatus(400);

  const mintEvents = event.events.token || [];
  for (const mint of mintEvents) {
    if (mint.type !== 'TOKEN_MINT') continue;
    const mintAddress = mint.mint;
    const timestamp = mint.timestamp || Date.now();

    await tokenCollection.updateOne(
      { tokenMint: mintAddress },
      { $set: { tokenMint: mintAddress, creationTime: timestamp } },
      { upsert: true }
    );
  }

  res.sendStatus(200);
});

connectDB().then(() => {
  const port = process.env.PORT || 10000;
  app.listen(port, () => {
    console.log(`✅ Webhook server running on port ${port}`);
  });
});

