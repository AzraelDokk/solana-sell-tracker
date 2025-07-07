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
const MONGODB_URI = process.env.MONGODB_URI;

const TOKEN_COLLECTION = 'tokens';

const tokenSchema = new mongoose.Schema({
  mint: { type: String, unique: true },
  firstSeen: Date,
});
const Token = mongoose.model('Token', tokenSchema);

async function connectToMongo() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('📦 Connected to MongoDB.');
  } catch (e) {
    console.error('❌ MongoDB connection failed:', e.message);
  }
}

// Fetch all transactions batch by batch using pagination cursor
async function fetchHistoricalSells() {
  console.log('📦 Starting historical sell fetch...');
  let before = null;
  let totalInserted = 0;
  while (true) {
    try {
      const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions${before ? `?before=${before}` : ''}`;
      const headers = { 'api-key': HELIUS_API_KEY };
      const response = await axios.get(url, { headers });

      const data = response.data;
      if (!data || data.length === 0) {
        break;
      }

      for (const tx of data) {
        before = tx.signature; // for next pagination

        // Detect swap/sell transactions by inspecting inner instructions or log messages
        const isSell = tx.transactionType === 'swap' || tx.logMessages?.some(msg => msg.includes('swap'));
        if (!isSell) continue;

        // Extract token mints sold in this tx from tokenTransfers where 'fromUserAccount' = wallet
        const soldMints = new Set();
        if (tx.tokenTransfers) {
          for (const tt of tx.tokenTransfers) {
            if (tt.fromUserAccount === WALLET_ADDRESS && parseFloat(tt.tokenAmount) > 0) {
              soldMints.add(tt.mint);
            }
          }
        }

        for (const mint of soldMints) {
          const exists = await Token.exists({ mint });
          if (!exists) {
            await Token.create({ mint, firstSeen: new Date(tx.timestamp * 1000) });
            totalInserted++;
            console.log(`📦 Inserted historical sell: ${mint}`);
          }
        }
      }

      console.log(`📦 Fetched batch, continuing before ${before}...`);
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log('📦 No more transactions found.');
        break;
      }
      console.error('❌ Error fetching historical sells:', err.message);
      break;
    }
  }
  console.log(`📦 Finished fetching. Total unique sells inserted: ${totalInserted}`);
}

// Webhook handler for real-time sells
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    if (!event.tokenTransfers) continue;

    for (const tt of event.tokenTransfers) {
      if (tt.fromUserAccount === WALLET_ADDRESS && parseFloat(tt.tokenAmount) > 0) {
        const mint = tt.mint;
        const exists = await Token.exists({ mint });
        if (!exists) {
          await Token.create({ mint, firstSeen: new Date() });
          const message = `🚨 First Token Sell Detected!\nToken Mint: ${mint}`;
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
          console.log(`⚠️ Already alerted for token ${mint}, skipping.`);
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


