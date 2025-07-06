const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
require('dotenv').config();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1'; // your wallet
const TG_TOKEN = process.env.TG_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID;
const ALERT_FILE = './alertedTokens.json';

app.use(express.json());

let alertedTokens = new Set();

// Load previously alerted token mints from file
function loadAlertedTokens() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    alertedTokens = new Set(JSON.parse(data));
    console.log(`📦 Loaded ${alertedTokens.size} previously sold token mints from history.`);
  } catch {
    alertedTokens = new Set();
    console.log('📦 No alert history found. Starting fresh.');
  }
}

// Save alerted tokens
function saveAlertedTokens() {
  fs.writeFileSync(ALERT_FILE, JSON.stringify([...alertedTokens]));
}

// Fetch historical SWAPs (sells only) from Helius
async function fetchPastTokenSells() {
  try {
    const url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP`;
    const { data } = await axios.get(url);

    for (const tx of data) {
      const events = tx.tokenTransfers || [];
      for (const event of events) {
        if (event.fromUserAccount === WALLET_ADDRESS && event.toUserAccount !== WALLET_ADDRESS) {
          // This means tokens left your wallet (aka a sell)
          alertedTokens.add(event.mint);
        }
      }
    }

    saveAlertedTokens();
    console.log(`📦 Fetched and stored past sells. Total = ${alertedTokens.size}`);
  } catch (err) {
    console.error('❌ Failed to fetch past tokens:', err.message);
  }
}

// Main webhook listener
app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));
  try {
    const events = req.body;
    if (!Array.isArray(events)) return res.sendStatus(400);

    for (const event of events) {
      const accounts = event.accountData || [];

      for (const account of accounts) {
        const tokenChanges = account.tokenBalanceChanges || [];

        for (const tokenChange of tokenChanges) {
          const amount = parseInt(tokenChange.rawTokenAmount.tokenAmount);
          const mint = tokenChange.mint;
          const user = tokenChange.userAccount;

          // Detect sells only (tokens leave your wallet)
          if (user === WALLET_ADDRESS && amount < 0 && !alertedTokens.has(mint)) {
            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;
            await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
              chat_id: TG_CHAT_ID,
              text: message,
              parse_mode: 'Markdown',
            });
            console.log('✅ Telegram alert sent!');

            alertedTokens.add(mint);
            saveAlertedTokens();
            return res.sendStatus(200);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Webhook handler error:', error.message);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  loadAlertedTokens();
  await fetchPastTokenSells();
  console.log(`✅ Listening on port ${PORT}`);
});



