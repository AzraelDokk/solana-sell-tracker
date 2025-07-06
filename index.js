const express = require('express');
const axios = require('axios');
const fs = require('fs');
const app = express();
app.use(express.json());

const SOLD_TOKENS_FILE = './soldTokens.json';

function loadSoldTokens() {
  try {
    return JSON.parse(fs.readFileSync(SOLD_TOKENS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveSoldTokens(tokens) {
  fs.writeFileSync(SOLD_TOKENS_FILE, JSON.stringify(tokens));
}

async function fetchPreviouslySoldTokens() {
  const apiKey = process.env.HELIUS_API_KEY;
  const wallet = process.env.WALLET_ADDRESS;
  const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${apiKey}&type=SWAP&limit=1000`;

  try {
    const { data } = await axios.get(url);
    const soldMints = new Set();

    for (const tx of data) {
      const transfers = tx.tokenTransfers || [];
      for (const t of transfers) {
        if (t.fromUserAccount === wallet && parseFloat(t.tokenAmount) > 0) {
          soldMints.add(t.mint);
        }
      }
    }

    return Array.from(soldMints);
  } catch (err) {
    console.error('Failed to fetch past tokens:', err.message);
    return [];
  }
}

app.post('/webhook', async (req, res) => {
  console.log('✅ Webhook received');

  let soldTokens = loadSoldTokens();
  const alreadySold = new Set(soldTokens);
  const wallet = process.env.WALLET_ADDRESS;

  try {
    const events = req.body;
    if (!Array.isArray(events)) return res.sendStatus(400);

    for (const event of events) {
      const accounts = event.accountData || [];

      let receivedSolOrUSDC = false;
      let soldTokenMint = null;

      for (const acc of accounts) {
        const tokenChanges = acc.tokenBalanceChanges || [];

        // Detect a token leaving your wallet (sell)
        for (const token of tokenChanges) {
          if (
            token.userAccount === wallet &&
            parseFloat(token.rawTokenAmount.tokenAmount) < 0 &&
            token.mint !== "So11111111111111111111111111111111111111112" // Not native SOL
          ) {
            soldTokenMint = token.mint;
          }
        }

        // Detect if your wallet received SOL or USDC
        if (acc.account === wallet) {
          if (acc.nativeBalanceChange > 0) {
            receivedSolOrUSDC = true;
          }

          for (const token of acc.tokenBalanceChanges || []) {
            if (
              token.userAccount === wallet &&
              parseFloat(token.rawTokenAmount.tokenAmount) > 0 &&
              (token.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" || // USDC
               token.mint === "So11111111111111111111111111111111111111112")  // Native SOL
            ) {
              receivedSolOrUSDC = true;
            }
          }
        }
      }

      if (soldTokenMint && receivedSolOrUSDC && !alreadySold.has(soldTokenMint)) {
        const msg = `🚨 First Token Sell Detected!\nToken Symbol: ${soldTokenMint}\nContract Address: ${soldTokenMint}`;
        await axios.post(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
          chat_id: process.env.TG_CHAT_ID,
          text: msg,
          parse_mode: 'Markdown'
        });

        console.log(`✅ Alert sent for mint: ${soldTokenMint}`);
        alreadySold.add(soldTokenMint);
        soldTokens.push(soldTokenMint);
        saveSoldTokens(soldTokens);
      } else if (soldTokenMint && alreadySold.has(soldTokenMint)) {
        console.log(`⚠️ Alert already sent for token mint ${soldTokenMint}, skipping.`);
      } else {
        console.log('ℹ️ No qualifying sell detected.');
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`✅ Listening on port ${PORT}`);
  const prev = await fetchPreviouslySoldTokens();
  saveSoldTokens(prev);
  console.log(`📦 Loaded ${prev.length} previously sold token mints from history.`);
});


