const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

const SOLD_TOKENS_FILE = './soldTokens.json';

// Load previously sold tokens
function loadSoldTokens() {
  try {
    return JSON.parse(fs.readFileSync(SOLD_TOKENS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

// Save updated list of sold tokens
function saveSoldTokens(tokens) {
  fs.writeFileSync(SOLD_TOKENS_FILE, JSON.stringify(tokens));
}

// Fetch token mints you've already sold (using Helius)
async function fetchPreviouslySoldTokens() {
  const apiKey = process.env.HELIUS_API_KEY;
  const wallet = process.env.WALLET_ADDRESS;
  const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${apiKey}&type=SWAP&limit=1000`;

  try {
    const { data } = await axios.get(url);
    const soldMints = new Set();

    for (const tx of data) {
      const accounts = tx?.tokenTransfers || [];
      for (const acc of accounts) {
        if (acc?.fromUserAccount === wallet && parseFloat(acc?.tokenAmount) > 0) {
          soldMints.add(acc.mint);
        }
      }
    }

    return Array.from(soldMints);
  } catch (err) {
    console.error('Failed to fetch past tokens:', err.message);
    return [];
  }
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received');

  let soldTokens = loadSoldTokens();
  const alreadySold = new Set(soldTokens);

  try {
    const body = req.body;
    if (!Array.isArray(body)) return res.sendStatus(400);

    for (const event of body) {
      const accounts = event.accountData || [];

      for (const acc of accounts) {
        const changes = acc.tokenBalanceChanges || [];

        for (const token of changes) {
          const isSell = parseInt(token.rawTokenAmount.tokenAmount) < 0;
          const mint = token.mint;

          if (isSell && !alreadySold.has(mint)) {
            // Send Telegram Alert
            const msg = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;
            const tgUrl = `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`;

            await axios.post(tgUrl, {
              chat_id: process.env.TG_CHAT_ID,
              text: msg,
              parse_mode: 'Markdown'
            });

            console.log(`✅ Alert sent for mint: ${mint}`);
            alreadySold.add(mint);
            soldTokens.push(mint);
            saveSoldTokens(soldTokens);
          } else if (alreadySold.has(mint)) {
            console.log(`⚠️ Alert already sent for token mint ${mint}, skipping.`);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`✅ Listening on port ${PORT}`);
  const previouslySold = await fetchPreviouslySoldTokens();
  saveSoldTokens(previouslySold);
  console.log(`📦 Loaded ${previouslySold.length} previously sold token mints from history.`);
});


