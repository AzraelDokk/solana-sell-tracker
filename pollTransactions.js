// pollTransactions.js

require('dotenv').config();
const { MongoClient } = require('mongodb');
const axios = require('axios');
const { sendTelegramMessage } = require('./utils');

const {
  HELIUS_API_KEY,
  WALLET_ADDRESS,
  MONGODB_URI,
} = process.env;

const client = new MongoClient(MONGODB_URI);
let soldCollection;

async function connectDB() {
  await client.connect();
  const db = client.db('solana_sells');
  soldCollection = db.collection('sold_tokens');
  console.log('✅ Connected to MongoDB');
}

async function getTokenCreationTime(tokenMint) {
  try {
    const url = `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`;
    const response = await axios.post(url, {
      mintAccounts: [tokenMint]
    });

    if (
      response.data &&
      response.data[0] &&
      response.data[0].onChainMetadata &&
      response.data[0].onChainMetadata.mint
    ) {
      return response.data[0].onChainMetadata.mint.createdAt;
    }
  } catch (err) {
    console.error(`❌ Error fetching token metadata for ${tokenMint}:`, err.message);
  }
  return null;
}

async function poll() {
  console.log('🔁 Polling for new transactions...');
  try {
    const txUrl = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&limit=20`;
    const txResponse = await axios.get(txUrl);
    const transactions = txResponse.data;

    for (const tx of transactions) {
      const signature = tx.signature;
      console.log(`🔍 Checking transaction ${signature}`);

      const isSwap = tx.type === 'SWAP';
      const userIsSource = tx?.events?.swap?.sourceUser === WALLET_ADDRESS;
      const tokenMint = tx?.events?.swap?.tokenA;

      if (!isSwap || !userIsSource || !tokenMint) {
        console.log(`ℹ️ Not a sell from wallet in tx ${signature}, skipping.`);
        continue;
      }

      const existingSale = await soldCollection.findOne({ tokenMint });
      if (existingSale) {
        console.log(`⛔ Token ${tokenMint} already alerted, skipping.`);
        continue;
      }

      const tokenCreatedAt = await getTokenCreationTime(tokenMint);
      if (!tokenCreatedAt) {
        console.log(`❓ Could not determine creation time for ${tokenMint}`);
        continue;
      }

      const tokenCreatedAtDate = new Date(tokenCreatedAt * 1000);
      const txDate = new Date(tx.blockTime * 1000);
      const diffInHours = (txDate - tokenCreatedAtDate) / (1000 * 60 * 60);

      console.log(`⏱ Token ${tokenMint} was created ${diffInHours.toFixed(2)} hours ago`);

      if (diffInHours <= 2) {
        await sendTelegramMessage(`🟢 ALERT: Wallet ${WALLET_ADDRESS} sold token ${tokenMint} within 2 hours of creation.\nTx: https://solscan.io/tx/${signature}`);
        await soldCollection.insertOne({ tokenMint, timestamp: tx.blockTime });
        console.log(`✅ Alert sent and saved for ${tokenMint}`);
      } else {
        console.log(`⏩ Token ${tokenMint} is older than 2 hours. Skipping alert.`);
      }
    }
  } catch (error) {
    console.error('❌ Polling error:', error.message);
  }
}

async function startPolling() {
  await connectDB();
  setInterval(poll, 1000 * 60 * 5); // Every 5 minutes
  poll(); // Run once immediately
}

startPolling();

