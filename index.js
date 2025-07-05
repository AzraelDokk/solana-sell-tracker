const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;  // e.g. "7613...:AAFX..."
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;      // your chat ID like "5473473053"

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('ERROR: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in environment variables!');
  process.exit(1);
}

app.post('/webhook', async (req, res) => {
  try {
    console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

    // Build the message to send to Telegram
    const message = `🚨 New webhook data received:\n\`\`\`\n${JSON.stringify(req.body, null, 2)}\n\`\`\``;

    // Send message to Telegram bot
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown'
    });

    res.status(200).send('ok');
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Render sets PORT environment variable automatically
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Listening on port ${PORT}`);
});

