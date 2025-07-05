const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';

// Load alert state (true/false)
function wasAlertSent() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    const obj = JSON.parse(data);
    return obj.alertSent === true;
  } catch {
    return false;
  }
}

// Save alert state
function markAlertSent() {
  fs.writeFileSync(ALERT_FILE, JSON.stringify({ alertSent: true }));
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

  if (wasAlertSent()) {
    console.log('⚠️ Alert already sent. Ignoring this event.');
    return res.sendStatus(200);
  }

  try {
    // Extract token sell info from Helius webhook payload
    const events = req.body; // usually an array
    if (!Array.isArray(events)) return res.sendStatus(400);

    // Loop through events to find first token sell
    for (const event of events) {
      const accountData = event.accountData || [];
      for (const account of accountData) {
        const tokenChanges = account.tokenBalanceChanges || [];
        for (const tokenChange of tokenChanges) {
          // If token amount is negative => sell
          if (parseInt(tokenChange.rawTokenAmount.tokenAmount) < 0) {
            const tokenSymbol = tokenChange.mint; // You might want to map mint to symbol using your logic
            const contractAddress = tokenChange.mint;

            // Prepare Telegram message
            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${tokenSymbol}\nContract Address: ${contractAddress}`;

            // Send Telegram message
            await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
              chat_id: process.env.TG_CHAT_ID,
              text: message,
              parse_mode: 'Markdown',
            });

            console.log('✅ Telegram alert sent!');
            markAlertSent();
            return res.sendStatus(200);
          }
        }
      }
    }

    // If no sell found, just respond OK
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


