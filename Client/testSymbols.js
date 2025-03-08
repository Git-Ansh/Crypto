const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@ticker');
ws.onopen = () => console.log("Connected");
ws.onmessage = (msg) => console.log("Message", msg.data);
ws.onerror = (err) => console.error("Error", err);
ws.onclose = (e) => console.log("Closed", e);
