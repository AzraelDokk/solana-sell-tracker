const express = require("express");
const fs = require("fs");
const fetch = require("node-fetch");

const TELEGRAM_BOT_TOKEN = "7613223933:AAFXYWU3qfqcTFgpd3lgfXMFgJAdWRIevNo";
const TELEGRAM_CHAT_ID = "5473473053"; // Your Telegram user ID from getUpdates
const WALLET_TO_TRACK = "8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf";

const LOG_FILE = "notified.json";
let hasNotified = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE)) : false;

const app = express();
app.use(express.json());

async function sendTelegram(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
  });
}

app.post("/webhook", async (req, res) => {
  if (hasNotified) return res.sendStatus(200);

  const events = req.body.events || [];

  for (const event of events) {
    // Check if the wallet sold any token by swap or token transfer out
    const isSwap = event.type === "SWAP" && event.source === WALLET_TO_TRACK;
    const isTransferOut = event.tokenTransfers?.some(
      (t) => t.fromUser === WALLET_TO_TRACK
    );

    if (isSwap || isTransferOut) {
      const tx = event.signature || "unknown";
      const msg = `🚨 Wallet ${WALLET_TO_TRACK} just SOLD a token.\n🔗 https://solscan.io/tx/${tx}`;

      await sendTelegram(msg);
      hasNotified = true;
      fs.writeFileSync(LOG_FILE, JSON.stringify(true));
      break;
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Listening on port ${PORT}`);
});
