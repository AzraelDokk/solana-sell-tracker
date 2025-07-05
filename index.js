const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';

// Load alert state (token-specific)
function getSentAlerts() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Save updated alert state
function markAlertSentForToken(mint) {
  const alerts = getSentAlerts();
  alerts[mint] = true;
  fs.writeFileSync(ALERT_FILE, JSON.stringify(alerts, null, 2));
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

  try {
    const events = req.body;
    if (!Array.isArray(events)) return res.sendStatus(400);

    const sentAlerts = getSentAlerts();

    for (const event of events) {
      const accountData = event.accountData || [];
      for (const account of accountData) {
        const tokenChanges = account.tokenBalanceChanges || [];
        for (const tokenChange of tokenChanges) {
          const mint = tokenChange.mint;
          const amount = parseInt(tokenChange.rawTokenAmount.tokenAmount);

          if (amount >= 0 || sentAlerts[mint]) continue;

          const tokenSymbol = mint;
          const contractAddress = mint;

          const message = `🚨 First Token Sell Detected!
Token Symbol: ${tokenSymbol}
Contract Address: ${contractAddress}`;

          await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
            chat_id: process.env.TG_CHAT_ID,
            text: message,
            parse_mode: 'Markdown',
          });

          console.log(`✅ Alert sent for ${mint}`);
          markAlertSentForToken(mint);
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

