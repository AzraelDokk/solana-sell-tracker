// index.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const WALLET_ADDRESS = 'G4UqKTzrao2mV1WAah8F7QRS8GYHGMgyaRb27ZZFxki1';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TG_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TG_CHAT_ID;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'solanaSellTracker';
const COLLECTION_NAME = 'soldTokens';

let dbClient;
let soldTokensCollection;

// Connect to MongoDB
async function connectMongo() {
  try {
    dbClient = new MongoClient(MONGODB_URI);
    await dbClient.connect();
    soldTokensCollection = dbClient.db(DB_NAME).collection(COLLECTION_NAME);
    // Create index for mint to avoid duplicates
    await soldTokensCollection.createIndex({ mint: 1 }, { unique: true });
    console.log('✅ Connected to MongoDB');
  } catch (e) {
    console.error('❌ MongoDB connection error:', e);
    process.exit(1);
  }
}

// Fetch ALL past SWAP transactions paginated and store sold tokens
async function fetchAllPastSoldTokens() {
  console.log('🔄 Fetching all past sold tokens...');
  let beforeSignature = null;
  let totalFound = 0;

  while (true) {
    try {
      // Build URL with pagination cursor (beforeSignature)
      let url = `https://api.helius.xyz/v0/addresses/${WALLET_ADDRESS}/transactions?api-key=${HELIUS_API_KEY}&type=SWAP&limit=100`;
      if (beforeSignature) url += `&before=${beforeSignature}`;

      const { data } = await axios.get(url);

      if (!Array.isArray(data) || data.length === 0) {
        console.log('ℹ️ No more transactions found.');
        break;
      }

      for (const tx of data) {
        if (!Array.isArray(tx.tokenTransfers)) continue;

        for (const transfer of tx.tokenTransfers) {
          // We only care about tokens sent FROM your wallet (selling tokens)
          if (
            transfer.fromUserAccount === WALLET_ADDRESS &&
            parseFloat(transfer.tokenAmount) > 0
          ) {
            try {
              // Insert sold token mint, ignore if already exists
              await soldTokensCollection.updateOne(
                { mint: transfer.mint },
                { $setOnInsert: { mint: transfer.mint, firstSeen: new Date() } },
                { upsert: true }
              );
              totalFound++;
            } catch (e) {
              if (e.code === 11000) {
                // Duplicate key error, ignore - token already recorded
              } else {
                console.error('❌ MongoDB insert error:', e);
              }
            }
          }
        }
      }

      // Prepare for next page: take last transaction's signature
      beforeSignature = data[data.length - 1].signature;

      // Optional: safety exit if too many pages
      if (totalFound > 1000) {
        console.log('⚠️ Safety stop: fetched 1000+ sold tokens, stopping pagination.');
        break;
      }
    } catch (e) {
      console.error('❌ Error fetching paginated transactions:', e.message);
      break;
    }
  }

  console.log(`✅ Finished fetching past sold tokens. Total unique sells recorded: ${totalFound}`);
}

// Send Telegram alert message
async function sendTelegramAlert(mint) {
  const message = `🚨 First Token Sell Detected!\nToken Mint: ${mint}`;
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    });
    console.log(`✅ Telegram alert sent for mint ${mint}`);
  } catch (e) {
    console.error('❌ Telegram send error:', e.response?.data || e.message);
  }
}

// Handle incoming webhook from Helius
app.post('/webhook', async (req, res) => {
  const events = req.body;
  if (!Array.isArray(events)) return res.sendStatus(400);

  for (const event of events) {
    const accountData = event.accountData || [];
    for (const account of accountData) {
      const changes = account.tokenBalanceChanges || [];
      for (const change of changes) {
        const { userAccount, rawTokenAmount, mint } = change;

        // Detect a sell: token amount < 0 from your wallet and mint NOT already recorded
        if (
          userAccount === WALLET_ADDRESS &&
          parseFloat(rawTokenAmount.tokenAmount) < 0
        ) {
          // Check if mint already exists in DB
          const alreadySold = await soldTokensCollection.findOne({ mint });
          if (alreadySold) {
            console.log(`ℹ️ Token mint ${mint} already sold before, skipping alert.`);
            continue;
          }

          // New sell found! Save and alert
          try {
            await soldTokensCollection.insertOne({ mint, firstSeen: new Date() });
            await sendTelegramAlert(mint);
          } catch (e) {
            if (e.code === 11000) {
              console.log(`ℹ️ Duplicate mint ${mint} on insert, skipping.`);
            } else {
              console.error('❌ MongoDB insert error:', e);
            }
          }
        }
      }
    }
  }

  res.sendStatus(200);
});

// Start the server
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  await connectMongo();
  await fetchAllPastSoldTokens();
  console.log(`✅ Listening on port ${PORT}`);
});


