const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
let db, tokensCollection;

async function connectDB() {
  if (!db) {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('solanaSellTracker');
    tokensCollection = db.collection('tokens');
    console.log('✅ [utils] Connected to MongoDB');
  }
}

async function saveTokenCreationTime(mint, timestamp) {
  await connectDB();
  const exists = await tokensCollection.findOne({ mint });
  if (!exists) {
    await tokensCollection.insertOne({ mint, creationTime: timestamp });
    console.log(`🧩 Saved token ${mint} created at ${new Date(timestamp * 1000).toISOString()}`);
  }
}

async function getTokenCreationTime(mint) {
  await connectDB();
  const token = await tokensCollection.findOne({ mint });
  return token ? token.creationTime : null;
}

module.exports = {
  saveTokenCreationTime,
  getTokenCreationTime
};

