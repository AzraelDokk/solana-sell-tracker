const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';

function loadAlertedTokens() {
  try {
    return JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAlertedTokens(data) {
  fs.writeFileSync(ALERT_FILE, JSON.stringify(data));
}

// Common system tokens to ignore
const ignoredMints = [
  "So11111111111111111111111111111111111111112", // SOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  // USDC
];

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

  try {
    const events = req.body;
    if (!Array.isArray(events)) return res.sendStatus(400);

    const alerted = loadAlertedTokens();

    for (const event of events) {
      const accountData = event.accountData || [];

      for (const account of accountData) {
        const tokenChanges = account.tokenBalanceChanges || [];

        for (const tokenChange of tokenChanges) {
          const mint = tokenChange.mint;

          // Skip if SOL/USDC or not a negative transfer
          if (
            ignoredMints.includes(mint) ||
            parseFloat(tokenChange.rawTokenAmount.tokenAmount) >= 0
          ) continue;

          // Skip if we've already alerted for this token
          if (alerted[mint]) {
            console.log(`⚠️ Already alerted for ${mint}`);
            continue;
          }

          // Send Telegram alert
          const message = `🚨 First Token Sell Detected!\nToken Symbol: ${mint}\nContract Address: ${mint}`;

          await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
            chat_id: process.env.TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
          });

          console.log('✅ Telegram alert sent for:', mint);

          alerted[mint] = true;
          saveAlertedTokens(alerted);

          return res.sendStatus(200);
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Listening on port ${PORT}`);
});

