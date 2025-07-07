require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const MONGO_URI = process.env.MONGO_URI;

// Define schema
const tokenSchema = new mongoose.Schema({
  mint: { type: String, unique: true },
  firstSeen: Date,
});
const Token = mongoose.model('Token', tokenSchema);

// Connect to MongoDB
async function connectToMongo() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('📦 Connected to MongoDB.');
  } catch (e) {
    console.error('❌ MongoDB connection failed:', e.message);
  }
}

// Fetch past sells from Helius and insert if not already in DB
async function fetchHistoricalSells() {
  try {
    let before = null;
    let totalInserted = 0;
    console.log('📦 Starting historical sell fetch...');

    while (true) {
      const url = new URL(`https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions`);
      url.searchParams.set('api-key', HELIUS_API_KEY);
      url.searchParams.set('type', 'SWAP');
      url.searchParams.set('limit', '100');
      if (before) url.searchParams.set('before', before);

      const { data } = await axios.get(url.toString());
      if (!Array.isArray(data) || data.length === 0) break;

      console.log(`📦 Fetched batch, continuing before ${data[data.length -1].signature}...`);

      for (const tx of data) {
        if (!tx.tokenTransfers) continue;

        for (const t of tx.tokenTransfers) {
          if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
            const exists = await Token.exists({ mint: t.mint });
            if (!exists) {
              await Token.create({ mint: t.mint, firstSeen: new Date() });
              totalInserted++;
            }
          }
        }
      }
      before = data[data.length -1].signature;
    }

    console.log(`📦 Finished fetching. Total unique sells inserted: ${totalInserted}`);
  } catch (err) {
    console.error('❌ Failed to fetch historical sells:', err.message);
  }
}

// Helper: Print all stored mints in DB for debugging
async function printStoredMints() {
  const tokens = await Token.find({}, { mint: 1, _id: 0 }).lean();
  console.log('📚 Stored mints in DB:', tokens.map(t => t.mint));
}

// Webhook to handle new token sells
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accounts = event.accountData || [];

    for (const account of accounts) {
      const changes = account.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;
        console.log(`🔍 Processing mint: ${mint} with amount: ${rawTokenAmount.tokenAmount}`);

        // Detect sell (negative token amount from our wallet)
        if (userAccount === WALLET_ADDRESS && parseFloat(rawTokenAmount.tokenAmount) < 0) {
          const exists = await Token.exists({ mint });

          if (!exists) {
            await Token.create({ mint, firstSeen: new Date() });

            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;
            try {
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
              });

              console.log('✅ Alert sent for', mint);
            } catch (e) {
              console.error('❌ Telegram error:', e.message);
            }
          } else {
            console.log(`⚠️ Already alerted for token ${mint}, skipping.`);
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
  await fetchHistoricalSells();
  await printStoredMints();
  console.log(`✅ Listening on port ${PORT}`);
});


