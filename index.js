require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
app.use(express.json());

// Load environment variables using YOUR keys
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 10000;
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

// Debug env status
console.log("--- Env Variable Check ---");
console.log("HELIUS_API_KEY:", HELIUS_API_KEY ? "Present" : "Missing");
console.log("WALLET_ADDRESS:", WALLET_ADDRESS);
console.log("TG_TOKEN:", TG_TOKEN ? "Present" : "Missing");
console.log("TG_CHAT_ID:", TG_CHAT_ID ? "Present" : "Missing");
console.log("MONGODB_URI:", MONGODB_URI ? "Present" : "Missing");

// MongoDB schema
const tokenSchema = new mongoose.Schema({
  mint: { type: String, unique: true },
  firstSeen: Date,
});
const Token = mongoose.model('Token', tokenSchema);

// Connect to MongoDB
async function connectToMongo() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('📦 Connected to MongoDB.');
  } catch (e) {
    console.error('❌ MongoDB connection failed:', e.message);
  }
}

// Fetch historical sells (with pagination)
async function fetchHistoricalSells() {
  console.log('📦 Starting historical sell fetch...');
  let before = null;
  let inserted = 0;

  try {
    while (true) {
      const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&limit=100&before=${before || ''}`;
      const { data } = await axios.get(url);
      if (!data || data.length === 0) break;

      for (const tx of data) {
        if (tx.type !== 'SWAP') continue;

        const tokenTransfers = tx.tokenTransfers || [];
        for (const transfer of tokenTransfers) {
          if (
            transfer.fromUserAccount === WALLET_ADDRESS &&
            parseFloat(transfer.tokenAmount) > 0
          ) {
            const exists = await Token.exists({ mint: transfer.mint });
            if (!exists) {
              await Token.create({ mint: transfer.mint, firstSeen: new Date() });
              inserted++;
            }
          }
        }
      }

      before = data[data.length - 1].signature;
      console.log(`📦 Fetched batch, continuing before ${before}...`);
    }
  } catch (err) {
    console.error('❌ Error fetching historical sells:', err.response?.status || err.message);
  }

  console.log(`📦 Finished fetching. Total unique sells inserted: ${inserted}`);
}

// Handle webhook POST from Helius
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accounts = event.accountData || [];

    for (const account of accounts) {
      const changes = account.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        if (
          userAccount === WALLET_ADDRESS &&
          parseFloat(rawTokenAmount.tokenAmount) < 0
        ) {
          const exists = await Token.exists({ mint });
          if (!exists) {
            await Token.create({ mint, firstSeen: new Date() });

            const msg = `🚨 First Token Sell Detected!\nToken: ${mint}\nhttps://solscan.io/token/${mint}`;
            try {
              await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
                chat_id: TG_CHAT_ID,
                text: msg,
                parse_mode: 'Markdown',
              });
              console.log(`✅ Alert sent for ${mint}`);
            } catch (e) {
              console.error('❌ Telegram error:', e.message);
            }
          } else {
            console.log(`⚠️ Already alerted for ${mint}, skipping.`);
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

// Start server
app.listen(PORT, async () => {
  await connectToMongo();
  await fetchHistoricalSells();
  console.log(`✅ Listening on port ${PORT}`);
});

