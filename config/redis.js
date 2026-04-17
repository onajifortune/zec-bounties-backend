const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) },
});

redisClient.on("error", (err) => console.error("Redis error:", err));

const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Redis connected");
  }
};

module.exports = { redisClient, connectRedis };
