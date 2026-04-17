const { redisClient } = require("../config/redis");

// Centralised TTLs — one place to tune them all
const TTL = {
  BOUNTY_LIST: 60, // seconds
  BOUNTY_SINGLE: 120,
  CATEGORIES: 300, // categories change rarely
  USERS: 120, // ← add
  ASSIGNEES: 60, // ← add
  APPLICATIONS: 30, // ← add
  SUBMISSIONS: 30, // ← add
  BALANCE: 15, // ← add (changes frequently)
  ADDRESSES: 120, // ← add
};

// Wrap every cache op so a Redis blip never crashes a request
const getCache = async (key) => {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error("Redis getCache error:", err);
    return null; // fall through to DB
  }
};

const setCache = async (key, value, ttl = TTL.BOUNTY_SINGLE) => {
  try {
    await redisClient.setEx(key, ttl, JSON.stringify(value));
  } catch (err) {
    console.error("Redis setCache error:", err);
    // non-fatal — request still succeeds
  }
};

const delCache = async (...keys) => {
  try {
    if (keys.length) await redisClient.del(...keys); // single round-trip
  } catch (err) {
    console.error("Redis delCache error:", err);
  }
};

// SCAN-based pattern delete — never blocks Redis like KEYS does
const deleteCacheByPattern = async (pattern) => {
  try {
    const keys = [];

    for await (const batch of redisClient.scanIterator({
      MATCH: pattern,
      COUNT: 100,
    })) {
      if (Array.isArray(batch)) {
        keys.push(...batch); // ✅ flatten
      } else {
        keys.push(batch); // fallback if it's a string
      }
    }

    console.log("Deleting keys:", keys);

    if (keys.length > 0) {
      const result = await redisClient.del(...keys);
      console.log("Deleted count:", result);
    }
  } catch (err) {
    console.error("Redis deleteCacheByPattern error:", err);
  }
};

module.exports = { getCache, setCache, delCache, deleteCacheByPattern, TTL };
