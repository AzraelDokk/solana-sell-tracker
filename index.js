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
  console.log('⏱️ Checking for new sells...');
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

    for (const tx of transactions) {
      const txSignature = tx.signature;
      console.log(`🔍 Checking transaction ${txSignature}`);

      if (!tx.tokenTransfers || tx.tokenTransfers.length === 0) {
        console.log(`ℹ️ No token transfers in tx ${txSignature}, skipping.`);
        continue;
      }

      // Look for sell (swap) token transfers: From wallet to another party
      // Filter tokenTransfers that are "swap" or "sell" — for simplicity, assume tokenTransfers where fromAddress == WALLET_ADDRESS means sell
      const sells = tx.tokenTransfers.filter(tt => 
        tt.fromUserAccount === WALLET_ADDRESS && tt.amount > 0
      );

      if (sells.length === 0) {
        console.log(`ℹ️ No sells from wallet in tx ${txSignature}, skipping.`);
        continue;
      }

      for (const sell of sells) {
        const tokenMint = sell.mint;
        console.log(`🔸 Detected sell of token ${tokenMint} in tx ${txSignature}`);

        // Check if already alerted for this token
        const alreadyAlerted = await hasAlreadyAlerted(tokenMint);
        if (alreadyAlerted) {
          console.log(`⚠️ Already alerted for token ${tokenMint}, skipping alert.`);
          continue;
        }

        // Check token creation timestamp
        const creationTime = await getTokenCreationTimestamp(tokenMint);
        if (!creationTime) {
          console.log(`⚠️ Unable to determine creation time for token ${tokenMint}, skipping alert.`);
          continue;
        }

        const creationDate = new Date(creationTime * 1000);
        console.log(`⏳ Token ${tokenMint} created at ${creationDate.toLocaleString()}`);

        // Check if token was created within last 2 hours
        const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
        if (creationDate.getTime() < twoHoursAgo) {
          console.log(`⚠️ Token ${tokenMint} created more than 2 hours ago, skipping alert.`);
          continue;
        }

        // Passed all checks — send Telegram alert
        const message = `🚨 Token Sell Detected!\n\n` +
          `Token Mint: ${tokenMint}\n` +
          `Created: ${creationDate.toLocaleString()}\n` +
          `Transaction: https://explorer.solana.com/tx/${txSignature}`;

        try {
          await bot.sendMessage(TG_CHAT_ID, message);
          console.log(`✅ Sent alert for token ${tokenMint}`);
          await markAlerted(tokenMint);
        } catch (err) {
          console.error(`❌ Failed to send Telegram message for token ${tokenMint}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('❌ Error checking sells:', error);
  }
}

async function start() {
  await connectDB();
  // Run check immediately on start
  await checkForNewSells();

  // Then schedule every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await checkForNewSells();
  });

  const port = process.env.PORT || 10000;
  require('http').createServer().listen(port, () => {
    console.log(`✅ Listening on port ${port}`);
  });
}

start();



