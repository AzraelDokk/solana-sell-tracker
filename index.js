require('dotenv').config();
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const cron = require('node-cron');
const http = require('http');

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
  const client = new MongoClient(MONGODB_URI, { family: 4 }); // Enforce IPv4 for Render
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
    if (!res.ok) {
      console.log(`⚠️ Failed to fetch token metadata for ${tokenMint}, status: ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data || !data.creationTime) {
      console.log(`⚠️ No creationTime found for token ${tokenMint}`);
      return null;
    }
    return data.creationTime; // Unix timestamp in seconds
  } catch (error) {
    console.log(`⚠️ Error fetching token metadata for ${tokenMint}:`, error);
    return null;
  }
}

async function checkForNewSells() {
  try {
    const res = await fetch(heliusBaseUrl);
    if (!res.ok) {
      console.log(`⚠️ Failed to fetch transactions, status: ${res.status}`);
      return;
    }
    const transactions = await res.json();
    if (!Array.isArray(transactions) || transactions.length === 0) {
      console.log('ℹ️ No recent transactions found.');
      return;
    }

    let foundSell = false;

    for (const tx of transactions) {
      const txSignature = tx.signature;

      if (!tx.tokenTransfers || tx.tokenTransfers.length === 0) continue;

      const sells = tx.tokenTransfers.filter(tt => 
        tt.fromUserAccount === WALLET_ADDRESS && tt.amount > 0
      );

      if (sells.length === 0) continue;

      foundSell = true;

      for (const sell of sells) {
        const tokenMint = sell.mint;

        const alreadyAlerted = await hasAlreadyAlerted(tokenMint);
        if (alreadyAlerted) continue;

        const creationTime = await getTokenCreationTimestamp(tokenMint);
        if (!creationTime) continue;

        const creationDate = new Date(creationTime * 1000);
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);

        if (creationDate.getTime() < twoHoursAgo) continue;

        const message = `🚨 Token Sell Detected!\n\nToken Mint: ${tokenMint}\nCreated: ${creationDate.toLocaleString()}\nTransaction: https://explorer.solana.com/tx/${txSignature}`;

        try {
          await bot.sendMessage(TG_CHAT_ID, message);
          await markAlerted(tokenMint);
          console.log(`✅ Alert sent for token ${tokenMint}`);
        } catch (err) {
          console.error(`❌ Telegram message error for token ${tokenMint}:`, err);
        }
      }
    }

    if (!foundSell) {
      console.log('ℹ️ No sells from wallet detected in recent transactions.');
    }

  } catch (error) {
    console.error('❌ Error checking sells:', error);
  }
}

async function start() {
  await connectDB();

  // Test Telegram alert on startup
  try {
    await bot.sendMessage(TG_CHAT_ID, '🚨 Bot started and connected successfully. Telegram alerts working!');
    console.log('✅ Sent test Telegram alert.');
  } catch (e) {
    console.error('❌ Failed to send test Telegram alert:', e);
  }

  await checkForNewSells();

  // Schedule to run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await checkForNewSells();
  });

  const port = process.env.PORT || 10000;
  http.createServer().listen(port, () => {
    console.log(`✅ Listening on port ${port}`);
  });
}

start();

