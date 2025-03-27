const WebSocket = require("ws");
const http = require("http");

function setupWebSocketProxy(server) {
  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws) => {
    console.log("Client connected to WebSocket proxy");

    // Connect to CryptoAPIs WebSocket
    const cryptoApiWs = new WebSocket("wss://ws.cryptoapis.io/v2");

    cryptoApiWs.on("open", () => {
      console.log("Connected to CryptoAPIs WebSocket");

      // Forward messages from client to CryptoAPIs
      ws.on("message", (message) => {
        console.log("Forwarding message to CryptoAPIs:", message.toString());
        cryptoApiWs.send(message.toString());
      });

      // Forward messages from CryptoAPIs to client
      cryptoApiWs.on("message", (message) => {
        console.log("Forwarding message from CryptoAPIs to client");
        ws.send(message.toString());
      });
    });

    cryptoApiWs.on("error", (error) => {
      console.error("CryptoAPIs WebSocket error:", error);
      ws.send(JSON.stringify({ error: "CryptoAPIs connection error" }));
    });

    cryptoApiWs.on("close", () => {
      console.log("CryptoAPIs WebSocket closed");
      ws.close();
    });

    ws.on("close", () => {
      console.log("Client disconnected from WebSocket proxy");
      cryptoApiWs.close();
    });
  });

  return wss;
}

module.exports = setupWebSocketProxy;
