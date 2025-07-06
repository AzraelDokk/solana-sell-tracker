const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const app = express();

require('dotenv').config();
app.use(express.json());

// ENV VARS
const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;

let db, soldCollection;

async function connectToMongo() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('SolanaSellTracker');
    soldCollection = db.collection('soldTokens');
    console.log('✅ Connected to MongoDB Atlas');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
  }
}

// Load historical data from Helius & store into DB
async function fetchAndStorePastSells() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP`;
    const { data } = await axios.get(url);
    let inserted = 0;

    for (const tx of data) {
      const transfers = tx.tokenTransfers || [];
      for (const t of transfers) {
        if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
          const already = await soldCollection.findOne({ mint: t.mint });
          if (!already) {
            await soldCollection.insertOne({ mint: t.mint });
            inserted++;
          }
        }
      }
    }

    console.log(`📦 Fetched and stored past sells. Total new = ${inserted}`);
  } catch (err) {
    console.error('❌ Failed to fetch past sells:', err.message);
  }
}

// Handle Helius webhook
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accounts = event.accountData || [];

    for (const acc of accounts) {
      const changes = acc.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        // Check for SELL (negative token balance)
        if (
          userAccount === WALLET_ADDRESS &&
          parseFloat(rawTokenAmount.tokenAmount) < 0
        ) {
          const already = await soldCollection.findOne({ mint });
          if (already) {
            console.log(`⚠️ Already alerted for ${mint}, skipping`);
            continue;
          }

          const msg = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;
          try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              chat_id: TELEGRAM_CHAT_ID,
              text: msg,
              parse_mode: 'Markdown'
            });

            await soldCollection.insertOne({ mint });
            console.log('✅ Alert sent & token stored');
          } catch (e) {
            console.error('❌ Telegram error:', e.message);
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectToMongo();
  await fetchAndStorePastSells();
  console.log(`✅ Listening on port ${PORT}`);
});

