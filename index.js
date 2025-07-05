const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

const WALLET_TO_TRACK = process.env.WALLET_TO_TRACK;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const NOTIFIED_FILE = './notified.json';

let notified = false;
if (fs.existsSync(NOTIFIED_FILE)) {
  try {
    const data = fs.readFileSync(NOTIFIED_FILE, 'utf8');
    const parsed = JSON.parse(data);
    notified = parsed.notified;
  } catch (err) {
    console.error('Error reading notified.json:', err);
  }
}

function saveNotifiedStatus(status) {
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify({ notified: status }));
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type === 'SWAP' && event.description.includes('Sold') && event.nativeAccount === WALLET_TO_TRACK) {
        console.log('🔍 Matched swap event for tracked wallet.');

        if (!notified) {
          const tokenInfo = event.description || 'Sold token';

          const message = `🚨 First sell detected for wallet:\n${WALLET_TO_TRACK}\n\n${tokenInfo}`;
          const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

          await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
          });

          console.log('✅ Telegram alert sent.');
          notified = true;
          saveNotifiedStatus(true);
        } else {
          console.log('ℹ️ Already notified, skipping Telegram alert.');
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error processing webhook:', err);
    res.sendStatus(500);
  }
});

// Optional root handler so Render shows something on /
app.get('/', (req, res) => {
  res.send('✅ Server is running.');
});

app.listen(port, () => {
  console.log(`✅ Listening on port ${port}`);
});

