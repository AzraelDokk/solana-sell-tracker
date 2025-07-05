const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';

function wasAlertSent() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    const obj = JSON.parse(data);
    return obj.alertSent === true;
  } catch {
    return false;
  }
}

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
    const events = req.body;
    if (!Array.isArray(events)) return res.sendStatus(400);

    for (const event of events) {
      const accountData = event.accountData || [];
      for (const account of accountData) {
        const tokenChanges = account.tokenBalanceChanges || [];
        for (const tokenChange of tokenChanges) {
          if (parseInt(tokenChange.rawTokenAmount.tokenAmount) < 0) {
            const mintAddress = tokenChange.mint;
            let tokenSymbol = mintAddress;

            try {
              const metadataResponse = await axios.get(
                `https://api.helius.xyz/v0/tokens/metadata?mint=${mintAddress}&api-key=${process.env.HELIUS_API_KEY}`
              );
              if (metadataResponse.data && metadataResponse.data.symbol) {
                tokenSymbol = metadataResponse.data.symbol;
              }
            } catch (err) {
              console.warn('⚠️ Could not fetch token symbol, using mint address.');
            }

            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${tokenSymbol}\nContract Address: ${mintAddress}`;

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

