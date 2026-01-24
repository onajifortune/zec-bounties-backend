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
// const { initSSE } = require("./helpers/broadcast");

const app = express();
const server = createServer(app);

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());

// SSE endpoint for frontend to subscribe
// app.get("/events", (req, res) => {
//   initSSE(req, res);
// });

// Run every Sunday at 10 PM
// cron.schedule("0 22 * * 0", async () => {
//   console.log("Processing Sunday batch payments...");
//   console.log("Batch payment list:", paymentList);
//   // call your processBatchPayments(paymentList) here
// });

// // Load the proto files
// const PROTO_PATH = path.join(__dirname, "/walletrpc/service.proto");
// const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
//   keepCase: true,
//   longs: String,
//   enums: String,
//   defaults: true,
//   oneofs: true,
//   includeDirs: [__dirname], // Directory containing both proto files
// });

// const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
// const CompactTxStreamer =
//   protoDescriptor.cash.z.wallet.sdk.rpc.CompactTxStreamer;

// // Create gRPC client
// const client = new CompactTxStreamer(
//   "zec.rocks:443",
//   grpc.credentials.createSsl(),
// );

// // Helper function to promisify gRPC calls
// function promisifyGrpcCall(method, request) {
//   return new Promise((resolve, reject) => {
//     client[method](request, (error, response) => {
//       if (error) {
//         reject(error);
//       } else {
//         resolve(response);
//       }
//     });
//   });
// }

// // Get lightwalletd info
// app.get("/api/zcash/info", async (req, res) => {
//   try {
//     const response = await promisifyGrpcCall("GetLightdInfo", {});
//     return res.status(200).json(response);
//   } catch (error) {
//     console.error("GetLightdInfo failed:", error);
//     return res.status(500).json({
//       error: "Failed to get lightwalletd info",
//       message: error.message,
//     });
//   }
// });

// // Get latest block
// app.get("/api/zcash/latest-block", async (req, res) => {
//   try {
//     const response = await promisifyGrpcCall("GetLatestBlock", {});
//     return res.status(200).json(response);
//   } catch (error) {
//     console.error("GetLatestBlock failed:", error);
//     return res.status(500).json({
//       error: "Failed to get latest block",
//       message: error.message,
//     });
//   }
// });

// // Get block by height
// app.get("/api/zcash/block/:height", async (req, res) => {
//   try {
//     const height = parseInt(req.params.height);
//     if (isNaN(height)) {
//       return res.status(400).json({ error: "Invalid height parameter" });
//     }

//     const response = await promisifyGrpcCall("GetBlock", { height });
//     return res.status(200).json(response);
//   } catch (error) {
//     console.error("GetBlock failed:", error);
//     return res.status(500).json({
//       error: "Failed to get block",
//       message: error.message,
//     });
//   }
// });

// // Get t-address balance
// app.post("/api/zcash/balance", async (req, res) => {
//   try {
//     const { addresses } = req.body;

//     if (!addresses || !Array.isArray(addresses)) {
//       return res.status(400).json({
//         error: "addresses array is required",
//       });
//     }

//     const response = await promisifyGrpcCall("GetTaddressBalance", {
//       addresses,
//     });

//     return res.status(200).json(response);
//   } catch (error) {
//     console.error("GetTaddressBalance failed:", error);
//     return res.status(500).json({
//       error: "Failed to get balance",
//       message: error.message,
//     });
//   }
// });

app.get("/", (req, res) => {
  res.json({
    status: "Server is running",
    endpoints: ["/auth", "/api/bounties", "/api/transactions"],
  });
});

app.use("/auth", require("./routes/auth"));
app.use("/api/bounties", require("./routes/bounties"));
app.use("/api/transactions", require("./routes/transactions"));

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
