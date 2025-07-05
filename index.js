const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());

const ALERT_FILE = './alertSent.json';

// Load alert state object mapping mint addresses to boolean
function loadAlertState() {
  try {
    const data = fs.readFileSync(ALERT_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Save alert state object
function saveAlertState(state) {
  fs.writeFileSync(ALERT_FILE, JSON.stringify(state));
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received:', JSON.stringify(req.body, null, 2));

  try {
    const events = req.body; // usually an array
    if (!Array.isArray(events)) return res.sendStatus(400);

    const alertState = loadAlertState();

    for (const event of events) {
      const accountData = event.accountData || [];
      for (const account of accountData) {
        const tokenChanges = account.tokenBalanceChanges || [];
        for (const tokenChange of tokenChanges) {
          const amount = parseInt(tokenChange.rawTokenAmount.tokenAmount);
          const decimals = tokenChange.rawTokenAmount.decimals || 0;
          const amountAbsolute = Math.abs(amount) / (10 ** decimals);

          // Detect sell: negative amount and amount > 1 token
          if (amount < 0 && amountAbsolute > 1) {
            const mint = tokenChange.mint;

            // Skip if alert already sent for this token mint
            if (alertState[mint]) {
              console.log(`⚠️ Alert already sent for token mint ${mint}, skipping.`);
              continue;
            }

            // Fetch token metadata from Helius
            let tokenSymbol = mint; // fallback to mint if no metadata
            try {
              const metadataRes = await axios.get(`https://api.helius.xyz/v0/tokens/metadata`, {
                params: {
                  'api-key': process.env.HELIUS_API_KEY,
                  mintAccounts: mint,
                },
              });
              if (metadataRes.data && metadataRes.data.length > 0) {
                tokenSymbol = metadataRes.data[0].symbol || mint;
              }
            } catch (err) {
              console.warn('⚠️ Failed to fetch token metadata:', err.message);
            }

            const contractAddress = mint;
            const message = `🚨 First Token Sell Detected!\nToken Symbol: ${tokenSymbol}\nContract Address: ${contractAddress}`;

            // Send Telegram message
            await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
              chat_id: process.env.TG_CHAT_ID,
              text: message,
              parse_mode: 'Markdown',
            });

            console.log('✅ Telegram alert sent for mint:', mint);

            // Mark alert sent for this token mint
            alertState[mint] = true;
            saveAlertState(alertState);

            // Only alert once per webhook call per token mint
            // continue to next tokenChange
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

