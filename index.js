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
const MONGO_URI = process.env.MONGODB_URI;  // <-- Use MONGODB_URI here

// Define token schema and model
const tokenSchema = new mongoose.Schema({
  mint: { type: String, unique: true },
  firstSeen: Date,
});
const Token = mongoose.model('Token', tokenSchema);

// Connect to MongoDB
async function connectToMongo() {
  try {
    await mongoose.connect(MONGO_URI, {
      // These options are now defaults, no need to specify but harmless to keep
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('📦 Connected to MongoDB.');
  } catch (e) {
    console.error('❌ MongoDB connection failed:', e.message);
  }
}

// Fetch all historical token sells from Helius (paging with cursor)
async function fetchHistoricalSells() {
  console.log('📦 Starting historical sell fetch...');
  let cursor = null;
  let totalInserted = 0;

  try {
    do {
      const url = new URL(`https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions`);
      url.searchParams.append('api-key', HELIUS_API_KEY);
      url.searchParams.append('type', 'SWAP');
      if (cursor) url.searchParams.append('before', cursor);

      const { data } = await axios.get(url.toString());
      if (!Array.isArray(data) || data.length === 0) break;

      for (const tx of data) {
        if (!tx.tokenTransfers) continue;

        for (const t of tx.tokenTransfers) {
          // Check if this is a sell from our wallet with positive amount
          if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
            const exists = await Token.exists({ mint: t.mint });
            if (!exists) {
              await Token.create({ mint: t.mint, firstSeen: new Date() });
              totalInserted++;
            }
          }
        }
      }

      cursor = data[data.length - 1].signature;
      console.log(`📦 Fetched batch, continuing before ${cursor}...`);

      // Safety break if something goes wrong with paging
      if (!cursor) break;

    } while (true);

    console.log(`📦 Finished fetching. Total unique sells inserted: ${totalInserted}`);
  } catch (error) {
    console.error('❌ Failed to fetch historical sells:', error.message);
  }
}

// Webhook endpoint for real-time sells
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accounts = event.accountData || [];

    for (const account of accounts) {
      const changes = account.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        // Detect sell: negative token amount from our wallet
        if (userAccount === WALLET_ADDRESS && parseFloat(rawTokenAmount.tokenAmount) < 0) {
          const exists = await Token.exists({ mint });

          if (!exists) {
            await Token.create({ mint, firstSeen: new Date() });

            const message = `🚨 First Token Sell Detected!\nToken Mint: ${mint}\nWallet: ${WALLET_ADDRESS}`;
            try {
              await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown',
              });

              console.log('✅ Alert sent for', mint);
            } catch (e) {
              console.error('❌ Telegram error:', e.message);
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectToMongo();
  await fetchHistoricalSells();
  console.log(`✅ Listening on port ${PORT}`);
});


