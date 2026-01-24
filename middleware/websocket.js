// Store all connected clients
const clients = new Set();

// Broadcast to all connected clients
function broadcast(data, excludeWs) {
  const message = JSON.stringify(data);
  console.log(message);
  clients.forEach((client) => {
    if (client.ws !== excludeWs && client.ws.readyState === 1) {
      client.ws.send(message);
    }
  });
}

// NEW: Get WebSocket connection by userId
function getClientByUserId(userId) {
  for (const client of clients) {
    if (client.userId === userId) {
      return client.ws;
    }
  }
  return null;
}

function handleWebSocket(ws, prisma) {
  let currentClient = null;

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "join":
          if (!message.userId) {
            ws.send(
              JSON.stringify({
                type: "error",
                content: "userId is required",
              })
            );
            break;
          }

          // Fetch user from database
          const user = await prisma.user.findUnique({
            where: { id: message.userId },
          });

          if (!user) {
            ws.send(
              JSON.stringify({
                type: "error",
                content: "User not found",
              })
            );
            break;
          }

          // Add client to connected clients
          currentClient = {
            ws,
            userId: user.id,
            userName: user.name,
          };
          clients.add(currentClient);

          // Send confirmation to the joining user
          ws.send(
            JSON.stringify({
              type: "joined",
              content: `Welcome, ${user.name}!`,
            })
          );

          // Broadcast to others that user joined
          broadcast(
            {
              type: "system",
              content: `${user.name} joined the chat`,
            },
            ws
          );

          console.log(
            `User ${user.name} connected. Total clients: ${clients.size}`
          );
          break;

        case "message":
          if (!currentClient || !message.content) {
            ws.send(
              JSON.stringify({
                type: "error",
                content: "Invalid message format or not joined",
              })
            );
            break;
          }

          // Save message to database
          const savedMessage = await prisma.message.create({
            data: {
              content: message.content,
              userId: currentClient.userId,
            },
            include: { user: true },
          });

          // Broadcast to all connected clients (including sender)
          const responseData = {
            type: "message",
            id: savedMessage.id,
            content: savedMessage.content,
            userName: savedMessage.user.name,
            userId: savedMessage.userId,
            createdAt: savedMessage.createdAt,
          };

          broadcast(responseData);
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
      }
    } catch (error) {
      console.error("WebSocket error:", error);
      ws.send(
        JSON.stringify({
          type: "error",
          content: "Server error",
        })
      );
    }
  });

  ws.on("close", () => {
    if (currentClient) {
      clients.delete(currentClient);
      console.log(
        `User ${currentClient.userName} disconnected. Total clients: ${clients.size}`
      );

      // Broadcast to others that user left
      broadcast({
        type: "system",
        content: `${currentClient.userName} left the chat`,
      });

      currentClient = null;
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    if (currentClient) {
      clients.delete(currentClient);
    }
  });
}

// UPDATED: Accept optional excludeUserId parameter
function sendRealtimeUpdate(type, payload, excludeUserId = null) {
  const excludeWs = excludeUserId ? getClientByUserId(excludeUserId) : null;
  broadcast({ type, payload }, excludeWs);
}

module.exports = { handleWebSocket, sendRealtimeUpdate, getClientByUserId };
