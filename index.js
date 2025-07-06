require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';
const MONGODB_URI = process.env.MONGODB_URI;
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

let db;
let soldTokensCollection;

// 🔌 Connect to MongoDB
async function connectMongo() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('SolanaSellTracker'); // Make sure this matches exactly, case-sensitive
    soldTokensCollection = db.collection('soldTokens');
    await soldTokensCollection.createIndex({ mint: 1 }, { unique: true });
    console.log('✅ Connected to MongoDB Atlas');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// 🕵️‍♂️ Fetch previously sold token mints from Helius
async function fetchPastSoldTokens() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP`;
    const { data } = await axios.get(url);

    let count = 0;

    for (const tx of data) {
      if (!Array.isArray(tx.tokenTransfers)) continue;

      for (const t of tx.tokenTransfers) {
        if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
          const mint = t.mint;

          // Insert only if not already in DB
          const existing = await soldTokensCollection.findOne({ mint });
          if (!existing) {
            await soldTokensCollection.insertOne({ mint });
            count++;
          }
        }
      }
    }

    console.log(`📦 Fetched and stored past sells. Total new = ${count}`);
  } catch (err) {
    console.error('❌ Failed to fetch past tokens:', err.message);
  }
}

// 🚨 Helius webhook
app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received');

  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accountData = event.accountData || [];

    for (const account of accountData) {
      const changes = account.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        if (
          userAccount === WALLET_ADDRESS &&
          parseFloat(rawTokenAmount.tokenAmount) < 0
        ) {
          const alreadyExists = await soldTokensCollection.findOne({ mint });

          if (!alreadyExists) {
            const message = `🚨 First Token Sell Detected!\nToken: ${mint}`;
            try {
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
              });
              console.log('✅ Telegram alert sent!');
            } catch (e) {
              console.error('❌ Error sending Telegram message:', e.message);
            }

            await soldTokensCollection.insertOne({ mint });
          } else {
            console.log(`⚠️ Duplicate sell skipped: ${mint}`);
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

// 🚀 Start the server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectMongo();
  await fetchPastSoldTokens();
  console.log(`✅ Listening on port ${PORT}`);
});



