require("dotenv").config();
const cron = require("node-cron");
const express = require("express");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const { createServer } = require("http");
const cors = require("cors");
const { handleWebSocket } = require("./middleware/websocket");
const { WebSocketServer } = require("ws");
const prisma = require("./prisma/client");
const { connectRedis } = require("./config/redis");
const {
  closeExpiredBountySubmissions,
  remindOverdueReviews,
} = require("./jobs/reviewWindow");

const app = express();
const server = createServer(app);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const allowedOrigins = [
  FRONTEND_URL,
  "https://zec-bounties-frontend.vercel.app",
];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "Server is running",
    endpoints: ["/auth", "/api/bounties", "/api/transactions"],
  });
});

app.use("/auth", require("./routes/auth"));
app.use("/api/bounties", require("./routes/bounties"));
app.use("/api/transactions", require("./routes/transactions"));
app.use("/api/zcash", require("./routes/zcash"));
app.use("/api/teams", require("./routes/teams"));
app.use("/api/kpis", require("./routes/kpis"));
app.use("/api/leaderboard", require("./routes/leaderboard"));
app.use("/api/onboarding", require("./routes/onboarding"));

// WebSocket server
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => handleWebSocket(ws, prisma));

// Middleware to attach wss to request object
app.use((req, res, next) => {
  req.wss = wss;
  next();
});

// ─── Day 5: contest-bounty deadline & review-window automation ────────────────
function startScheduledJobs() {
  // Every 15 minutes — catch expired BOUNTY listings quickly so creators
  // aren't left thinking submissions are still open when they're not.
  cron.schedule("*/15 * * * *", async () => {
    try {
      const result = await closeExpiredBountySubmissions();
      if (result.closed > 0) {
        console.log(`[cron] Closed ${result.closed} expired bounty listing(s)`);
      }
    } catch (err) {
      console.error("[cron] closeExpiredBountySubmissions failed:", err);
    }
  });

  // Once a day at 9am server time — nudge creators who haven't picked winners
  cron.schedule("0 9 * * *", async () => {
    try {
      const result = await remindOverdueReviews();
      if (result.remindersSent > 0) {
        console.log(`[cron] Sent ${result.remindersSent} review reminder(s)`);
      }
    } catch (err) {
      console.error("[cron] remindOverdueReviews failed:", err);
    }
  });

  console.log(
    "[cron] Scheduled jobs started (deadline closure + review reminders)",
  );
}

// Start server
const PORT = process.env.PORT || 9001;
server.listen(PORT, async () => {
  await connectRedis();
  startScheduledJobs();
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  wss.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nShutting down gracefully...");
  wss.close();
  await prisma.$disconnect();
  process.exit(0);
});
