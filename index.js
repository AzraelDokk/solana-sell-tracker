const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');
const app = express();
app.use(express.json());

// ENVIRONMENT VARIABLES
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';

// MongoDB setup
let db, soldCollection;
async function connectToMongo() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db('solanaTracker');
  soldCollection = db.collection('soldTokens');
  console.log('✅ Connected to MongoDB Atlas');
}

// Fetch past sold token mints from Helius and save to DB
async function fetchPastSoldTokens() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP`;
    const { data } = await axios.get(url);
    let newMints = [];

    for (const tx of data) {
      if (!Array.isArray(tx.tokenTransfers)) continue;

      for (const t of tx.tokenTransfers) {
        if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
          const already = await soldCollection.findOne({ mint: t.mint });
          if (!already) {
            newMints.push({ mint: t.mint });
          }
        }
      }
    }

    if (newMints.length > 0) {
      await soldCollection.insertMany(newMints);
    }

    console.log(`📦 Fetched and stored past sells. Total new = ${newMints.length}`);
  } catch (err) {
    console.error('❌ Failed to fetch past tokens:', err.message);
  }
}

// Webhook handler
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
          const already = await soldCollection.findOne({ mint });

          if (!already) {
            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;

            try {
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
              });

              console.log('✅ Telegram alert sent!');
              await soldCollection.insertOne({ mint });
            } catch (e) {
              console.error('❌ Telegram error:', e.response?.data || e.message);
            }

            return res.sendStatus(200);
          }
        }
      }
    }
  }

  console.log('ℹ️ No new sells detected.');
  res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectToMongo();
  await fetchPastSoldTokens();
  console.log(`✅ Listening on port ${PORT}`);
});
