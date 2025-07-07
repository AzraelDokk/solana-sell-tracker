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

// Define schema & model for sold tokens
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
    process.exit(1);
  }
}

// Fetch all historical sells with pagination
async function fetchHistoricalSells() {
  try {
    let count = 0;
    let before = null;
    while (true) {
      let url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?type=SWAP&api-key=${HELIUS_API_KEY}`;
      if (before) url += `&before=${before}`;

      const { data } = await axios.get(url);
      if (!data.length) break;  // no more transactions to fetch

      for (const tx of data) {
        if (!tx.tokenTransfers) continue;

        for (const t of tx.tokenTransfers) {
          // Only consider tokens sent from your wallet (i.e., sells)
          if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
            const exists = await Token.exists({ mint: t.mint });
            if (!exists) {
              try {
                await Token.create({ mint: t.mint, firstSeen: new Date() });
                count++;
              } catch (e) {
                // Ignore duplicate key errors
                if (e.code !== 11000) {
                  console.error('❌ Error inserting historical token:', e.message);
                }
              }
            }
          }
        }
      }

      before = data[data.length - 1].signature;
      console.log(`📦 Fetched batch, continuing before ${before}...`);
    }

    console.log(`📦 Fetched and saved ${count} historical token sells in total.`);
  } catch (err) {
    console.error('❌ Failed to fetch historical sells:', err.message);
  }
}

// Webhook endpoint to receive live events from Helius
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accounts = event.accountData || [];

    for (const account of accounts) {
      const changes = account.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        // Detect sells: negative token amount from your wallet
        if (userAccount === WALLET_ADDRESS && parseFloat(rawTokenAmount.tokenAmount) < 0) {
          const exists = await Token.exists({ mint });

          if (!exists) {
            try {
              await Token.create({ mint, firstSeen: new Date() });

              const message = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
              });

              console.log('✅ Alert sent for', mint);
            } catch (e) {
              console.error('❌ Telegram or DB error:', e.response?.data || e.message);
            }
          } else {
            console.log(`⚠️ Alert already sent for token ${mint}, skipping.`);
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

// Start the server and initialize
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectToMongo();
  await fetchHistoricalSells();
  console.log(`✅ Listening on port ${PORT}`);
});


