const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';
const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;

let alreadySold = new Set();

// 🔄 Load previously sold tokens from file
function loadPreviouslySold() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed.tokens)) {
      alreadySold = new Set(parsed.tokens);
    }
  } catch {
    alreadySold = new Set();
  }
}

// 💾 Save updated sold tokens
function savePreviouslySold() {
  fs.writeFileSync(ALERT_FILE, JSON.stringify({ tokens: Array.from(alreadySold) }));
}

// 🕵️‍♂️ Fetch past token sells from Helius (SWAP type only)
async function fetchPastSoldTokens() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP`;
    const { data } = await axios.get(url);
    const tokenMints = new Set();

    data.forEach((tx) => {
      if (!Array.isArray(tx.tokenTransfers)) return;
      tx.tokenTransfers.forEach((t) => {
        if (t.fromUserAccount === WALLET_ADDRESS && parseFloat(t.tokenAmount) > 0) {
          tokenMints.add(t.mint);
        }
      });
    });

    alreadySold = new Set([...alreadySold, ...tokenMints]);
    savePreviouslySold();
    console.log(`📦 Fetched and stored past sells. Total = ${alreadySold.size}`);
  } catch (e) {
    console.error('❌ Failed to fetch past tokens:', e.message);
  }
}

// 🚨 Handle incoming Helius webhook
app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

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
          parseFloat(rawTokenAmount.tokenAmount) < 0 &&
          !alreadySold.has(mint)
        ) {
          const tokenSymbol = mint;
          const contractAddress = mint;

          const message = `🚨 First Token Sell Detected!\nToken Symbol: ${tokenSymbol}\nContract Address: ${contractAddress}`;

          try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
              chat_id: TELEGRAM_CHAT_ID,
              text: message,
              parse_mode: 'Markdown'
            });

            console.log('✅ Telegram alert sent!');
            alreadySold.add(mint);
            savePreviouslySold();
          } catch (e) {
            console.error('❌ Error sending Telegram message:', e.response?.data || e.message);
          }

          return res.sendStatus(200);
        }
      }
    }
  }

  console.log('ℹ️ No new sells detected.');
  res.sendStatus(200);
});

// 🚀 Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  loadPreviouslySold();
  console.log(`📦 Loaded ${alreadySold.size} previously sold token mints from history.`);
  await fetchPastSoldTokens();
  console.log(`✅ Listening on port ${PORT}`);
});

