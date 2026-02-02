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

const app = express();
const server = createServer(app);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
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

// WebSocket server
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => handleWebSocket(ws, prisma));

// Middleware to attach wss to request object
app.use((req, res, next) => {
  req.wss = wss;
  next();
});

// Start server
const PORT = process.env.PORT || 9001;
server.listen(PORT, () => {
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
