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

console.log('--- Env Variable Check ---');
console.log('HELIUS_API_KEY:', HELIUS_API_KEY ? 'Present' : 'Missing');
console.log('WALLET_ADDRESS:', WALLET_ADDRESS ? WALLET_ADDRESS : 'Missing');
console.log('TELEGRAM_BOT_TOKEN:', TELEGRAM_BOT_TOKEN ? 'Present' : 'Missing');
console.log('TELEGRAM_CHAT_ID:', TELEGRAM_CHAT_ID ? 'Present' : 'Missing');
console.log('MONGODB_URI:', MONGODB_URI ? 'Present' : 'Missing');

if (!HELIUS_API_KEY || !WALLET_ADDRESS || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !MONGODB_URI) {
  console.error('❌ Missing one or more required environment variables. Exiting.');
  process.exit(1);
}

// Define Mongoose schema and model
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
    process.exit(1);
  }
}

// Fetch all historical token sells via paginated Helius API
async function fetchHistoricalSells() {
  console.log('📦 Starting historical sell fetch...');
  let before = null;
  let totalInserted = 0;

  try {
    while (true) {
      let url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP&limit=50`;
      if (before) url += `&before=${before}`;

      const response = await axios.get(url);
      const data = response.data;

      if (!Array.isArray(data) || data.length === 0) break;

      for (const tx of data) {
        if (!tx.tokenTransfers) continue;

        for (const t of tx.tokenTransfers) {
          // Sell detection: fromUserAccount === wallet and tokenAmount > 0 (token sent out)
          if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
            const exists = await Token.exists({ mint: t.mint });
            if (!exists) {
              await Token.create({ mint: t.mint, firstSeen: new Date() });
              totalInserted++;
            }
          }
        }
      }

      before = data[data.length - 1].signature; // paginate
      console.log(`📦 Fetched batch, continuing before ${before}...`);
    }

    console.log(`📦 Finished fetching. Total unique sells inserted: ${totalInserted}`);
  } catch (err) {
    console.error('❌ Error fetching historical sells:', err.response?.status || err.message);
  }
}

// Webhook handler for real-time sells
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accounts = event.accountData || [];

    for (const account of accounts) {
      const changes = account.tokenBalanceChanges || [];

      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        // Detect sell: userAccount === wallet and negative tokenAmount (sent tokens)
        if (userAccount === WALLET_ADDRESS && parseFloat(rawTokenAmount.tokenAmount) < 0) {
          const exists = await Token.exists({ mint });

          if (!exists) {
            await Token.create({ mint, firstSeen: new Date() });

            const message = `🚨 First Token Sell Detected!\nToken Mint: ${mint}\nContract Address: ${mint}`;
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
            console.log(`⚠️ Alert already sent for token ${mint}, skipping.`);
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
  console.log(`✅ Listening on port ${PORT}`);
});

