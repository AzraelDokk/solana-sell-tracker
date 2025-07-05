const axios = require('axios');
const express = require('express');
const app = express();
app.use(express.json());

async function getTokenInfo(mintAddress) {
  try {
    // Get token metadata from Solscan API
    const metaRes = await axios.get(`https://public-api.solscan.io/token/meta?tokenAddress=${mintAddress}`);
    const symbol = metaRes.data.symbol || "Unknown";
    return { symbol };
  } catch (error) {
    console.error("Failed to fetch token info:", error.message);
    return null;
  }
}

async function sendTelegramMessage(text) {
  const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(TELEGRAM_API, {
      chat_id: process.env.CHAT_ID,
      text,
    });
    console.log("Telegram message sent");
  } catch (err) {
    console.error("Error sending Telegram message:", err.response?.data || err.message);
  }
}

app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Find first token sell event (negative tokenAmount)
    let mintAddress = null;
    for (const item of body) {
      for (const account of item.accountData) {
        if (account.tokenBalanceChanges) {
          for (const tokenChange of account.tokenBalanceChanges) {
            const amount = Number(tokenChange.rawTokenAmount.tokenAmount);
            if (amount < 0) {
              mintAddress = tokenChange.mint;
              break;
            }
          }
        }
        if (mintAddress) break;
      }
      if (mintAddress) break;
    }

    if (!mintAddress) {
      console.log("No token sell detected.");
      res.status(200).send("No sell event");
      return;
    }

    // Get token symbol
    const tokenInfo = await getTokenInfo(mintAddress);

    if (!tokenInfo) {
      await sendTelegramMessage(`Token sell detected\nContract Address: ${mintAddress}\nSymbol not found.`);
    } else {
      const message = `Token Symbol: ${tokenInfo.symbol}\nContract Address: ${mintAddress}`;
      await sendTelegramMessage(message);
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Internal Server Error");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});


