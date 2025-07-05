const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';

// Load alerted tokens list from file
function loadAlertedTokens() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    const obj = JSON.parse(data);
    return obj.alertedTokens || [];
  } catch {
    return [];
  }
}

// Save alerted tokens list to file
function saveAlertedTokens(tokens) {
  fs.writeFileSync(ALERT_FILE, JSON.stringify({ alertedTokens: tokens }));
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

  const alertedTokens = loadAlertedTokens();

  try {
    const events = req.body;
    if (!Array.isArray(events)) return res.sendStatus(400);

    for (const event of events) {
      const accountData = event.accountData || [];
      for (const account of accountData) {
        const tokenChanges = account.tokenBalanceChanges || [];
        for (const tokenChange of tokenChanges) {
          if (parseInt(tokenChange.rawTokenAmount.tokenAmount) < 0) {
            const tokenMint = tokenChange.mint;

            if (alertedTokens.includes(tokenMint)) {
              console.log(`⚠️ Alert already sent for token ${tokenMint}. Ignoring.`);
              continue;
            }

            // Compose Telegram message (Token Symbol and Contract Address)
            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${tokenMint}\nContract Address: ${tokenMint}`;

            await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
              chat_id: process.env.TG_CHAT_ID,
              text: message,
              parse_mode: 'Markdown',
            });

            console.log('✅ Telegram alert sent!');

            alertedTokens.push(tokenMint);
            saveAlertedTokens(alertedTokens);

            return res.sendStatus(200);
          }
        }
      }
    }

    // No sells detected in this webhook payload
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

