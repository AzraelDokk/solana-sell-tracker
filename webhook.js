require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { saveTokenCreationTime } = require('./utils');

const app = express();
app.use(bodyParser.json());

app.post('/webhook', async (req, res) => {
  const webhookData = req.body;

  if (!webhookData || !Array.isArray(webhookData)) {
    console.log('❌ Invalid webhook payload.');
    return res.status(400).send('Invalid webhook format');
  }

  for (const tx of webhookData) {
    if (
      tx.type === 'TOKEN_MINT' &&
      tx.events?.token?.mint &&
      tx.timestamp
    ) {
      const mint = tx.events.token.mint;
      const timestamp = tx.timestamp;
      await saveTokenCreationTime(mint, timestamp);
    }
  }

  res.sendStatus(200);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Webhook server running on port ${port}`);
});

