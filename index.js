require('dotenv').config();
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const cron = require('node-cron');

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS.toLowerCase();
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

if (!HELIUS_API_KEY || !WALLET_ADDRESS || !TG_TOKEN || !TG_CHAT_ID || !MONGODB_URI) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const heliusBaseUrl = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}`;
const tokenMetaUrl = (mint) => `https://api.helius.xyz/v0/mints/${mint}?api-key=${HELIUS_API_KEY}`;

const bot = new TelegramBot(TG_TOKEN);
let db, alertsCollection;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db('solanaSellTracker');
  alertsCollection = db.collection('alerts');
  console.log('📦 Connected to MongoDB.');
}

async function hasAlreadyAlerted(tokenMint) {
  return !!(await alertsCollection.findOne({ tokenMint }));
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
  } catch {
    return null;
  }
}

async function checkForNewSells() {
  try {
    const res = await fetch(heliusBaseUrl);
    if (!res.ok) return;
    const transactions = await res.json();
    if (!Array.isArray(transactions) || transactions.length === 0) return;

    for (const tx of transactions) {
      if (!tx.tokenTransfers) continue;

      // Filter sells where fromUserAccount matches wallet (case insensitive)
      const sells = tx.tokenTransfers.filter(tt =>
        tt.fromUserAccount?.toLowerCase() === WALLET_ADDRESS && tt.amount > 0
      );
      if (sells.length === 0) continue;

      for (const sell of sells) {
        const tokenMint = sell.mint;

        if (await hasAlreadyAlerted(tokenMint)) continue;

        const creationTime = await getTokenCreationTimestamp(tokenMint);
        if (!creationTime) continue;

        const creationDate = new Date(creationTime * 1000);
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        if (creationDate.getTime() < twoHoursAgo) continue;

        const message =
          `🚨 Token Sell Detected!\n\n` +
          `Token Mint: ${tokenMint}\n` +
          `Created: ${creationDate.toLocaleString()}\n` +
          `Transaction: https://explorer.solana.com/tx/${tx.signature}`;

        try {
          await bot.sendMessage(TG_CHAT_ID, message);
          await markAlerted(tokenMint);
          console.log(`✅ Alert sent for token ${tokenMint}`);
        } catch (err) {
          console.error('❌ Telegram sendMessage error:', err.message);
        }
      }
    }
  } catch (error) {
    console.error('❌ checkForNewSells error:', error.message);
  }
}

async function start() {
  await connectDB();
  await checkForNewSells();

  cron.schedule('*/5 * * * *', checkForNewSells);

  const port = process.env.PORT || 10000;
  require('http').createServer().listen(port, () => {
    console.log(`✅ Listening on port ${port}`);
  });
}

start();



