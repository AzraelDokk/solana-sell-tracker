// utils.js

const axios = require('axios');
require('dotenv').config();

const { TG_TOKEN, TG_CHAT_ID } = process.env;

async function sendTelegramMessage(message) {
  const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: TG_CHAT_ID,
      text: message,
    });
  } catch (err) {
    console.error('❌ Telegram send error:', err.message);
  }
}

module.exports = { sendTelegramMessage };

