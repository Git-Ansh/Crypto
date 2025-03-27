const http = require("http");

const server = http.createServer((req, res) => {
  res.end("Test server");
});

server.listen(5000, () => {
  console.log("Test server running on port 5000");
});

// Close the server after 5 seconds
setTimeout(() => {
  server.close(() => {
    console.log("Test server closed");
  });
}, 5000);
