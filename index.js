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
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const BASE_URL = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?type=SWAP&api-key=${HELIUS_API_KEY}`;

const tokenSchema = new mongoose.Schema({
  mint: { type: String, unique: true },
  firstSeen: Date
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

// Fetch ALL historical sells
async function fetchAllHistoricalSells() {
  let beforeTx = null;
  let inserted = 0;
  console.log('📦 Starting historical sell fetch...');

  while (true) {
    try {
      const url = beforeTx ? `${BASE_URL}&before=${beforeTx}` : BASE_URL;
      const { data } = await axios.get(url);

      if (!data.length) break;

      for (const tx of data) {
        if (!tx.tokenTransfers) continue;

        for (const t of tx.tokenTransfers) {
          if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
            const exists = await Token.exists({ mint: t.mint });
            if (!exists) {
              await Token.create({ mint: t.mint, firstSeen: new Date(tx.timestamp * 1000) });
              inserted++;
            }
          }
        }
      }

      beforeTx = data[data.length - 1].signature;
      console.log(`📦 Fetched batch, continuing before ${beforeTx}...`);
    } catch (e) {
      console.error('❌ Failed to fetch historical sells:', e.message);
      break;
    }
  }

  console.log(`📦 Finished fetching. Total unique sells inserted: ${inserted}`);
}

// Handle incoming webhook from Helius
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
          parseFloat(rawTokenAmount?.tokenAmount || 0) < 0
        ) {
          const exists = await Token.exists({ mint });

          if (!exists) {
            await Token.create({ mint, firstSeen: new Date() });

            const message = `🚨 *First Token Sell Detected!*\n\n🪙 Token: \`${mint}\`\n🔗 https://solscan.io/token/${mint}`;
            try {
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
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

// Start the server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectToMongo();
  await fetchAllHistoricalSells();
  console.log(`✅ Listening on port ${PORT}`);
});

