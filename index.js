require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

const DB_NAME = 'SolanaSellTracker'; // ✅ CASE-SENSITIVE
const COLLECTION_NAME = 'sold_tokens';

let dbClient;
let soldTokens = new Set();

async function connectMongo() {
  try {
    dbClient = new MongoClient(MONGODB_URI);
    await dbClient.connect();
    console.log('✅ Connected to MongoDB Atlas');

    const db = dbClient.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const tokens = await collection.find({}).toArray();
    soldTokens = new Set(tokens.map(t => t.mint));
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function storeTokenMint(mint) {
  const db = dbClient.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);
  await collection.updateOne({ mint }, { $set: { mint } }, { upsert: true });
  soldTokens.add(mint);
}

async function fetchPastSoldTokens() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP`;
    const { data } = await axios.get(url);

    let newCount = 0;
    for (const tx of data) {
      const transfers = tx.tokenTransfers || [];
      for (const t of transfers) {
        if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0 && !soldTokens.has(t.mint)) {
          await storeTokenMint(t.mint);
          newCount++;
        }
      }
    }

    console.log(`📦 Fetched and stored past sells. Total new = ${newCount}`);
  } catch (e) {
    console.error('❌ Failed to fetch past tokens:', e.message);
  }
}

app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const changes = event.accountData?.flatMap(a => a.tokenBalanceChanges || []) || [];

    for (const change of changes) {
      const { userAccount, rawTokenAmount, mint } = change;

      if (
        userAccount === WALLET_ADDRESS &&
        parseFloat(rawTokenAmount.tokenAmount) < 0 &&
        !soldTokens.has(mint)
      ) {
        const message = `🚨 First Token Sell Detected!\nToken: ${mint}`;

        try {
          await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
          });

          console.log('✅ Telegram alert sent!');
          await storeTokenMint(mint);
        } catch (e) {
          console.error('❌ Telegram error:', e.response?.data || e.message);
        }
      }
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, async () => {
  await connectMongo();
  await fetchPastSoldTokens();
  console.log(`✅ Listening on port ${PORT}`);
});


