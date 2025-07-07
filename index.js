require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const WALLET = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';
const HeliusKey = process.env.HELIUS_API_KEY;
const TelegramToken = process.env.TG_TOKEN;
const TelegramChatID = process.env.TG_CHAT_ID;

const SoldToken = mongoose.model('SoldToken', new mongoose.Schema({
  mint: { type: String, unique: true },
  timestamp: Date
}));

// Fetch and save past sells from Helius
async function preloadPastSells() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET}/transactions?api-key=${HeliusKey}&type=SWAP`;
    const { data } = await axios.get(url);
    let count = 0;

    for (const tx of data) {
      for (const t of tx.tokenTransfers || []) {
        if (t.fromUserAccount === WALLET && parseFloat(t.tokenAmount) > 0) {
          await SoldToken.updateOne(
            { mint: t.mint },
            { mint: t.mint, timestamp: new Date(tx.timestamp) },
            { upsert: true }
          );
          count++;
        }
      }
    }

    console.log(`📦 Fetched and saved ${count} historical token sells.`);
  } catch (err) {
    console.error('❌ Error fetching past sells:', err.message);
  }
}

// Telegram alert sender
async function sendTelegramAlert(tokenMint) {
  const message = `🚨 First Token Sell Detected!\nToken Symbol: ${tokenMint}\nContract Address: ${tokenMint}`;
  await axios.post(`https://api.telegram.org/bot${TelegramToken}/sendMessage`, {
    chat_id: TelegramChatID,
    text: message,
    parse_mode: 'Markdown'
  });
  console.log('✅ Telegram alert sent!');
}

// Webhook handler
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const changes = (event.accountData || []).flatMap(a => a.tokenBalanceChanges || []);

    for (const change of changes) {
      const { userAccount, mint, rawTokenAmount } = change;

      if (
        userAccount === WALLET &&
        parseFloat(rawTokenAmount.tokenAmount) < 0 &&
        !(await SoldToken.exists({ mint }))
      ) {
        await sendTelegramAlert(mint);
        await SoldToken.create({ mint, timestamp: new Date() });
        return res.sendStatus(200);
      }
    }
  }

  res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log('📦 Connected to MongoDB.');
  await preloadPastSells();
  console.log(`✅ Listening on port ${PORT}`);
});



