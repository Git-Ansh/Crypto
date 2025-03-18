const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  // Get token from header OR cookie
  let token;

  // Check Authorization header first (Bearer token)
  const authHeader = req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
    console.log("Token Debug - token source: Authorization header");
  }
  // Then check cookies
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
    console.log("Token Debug - token source: Cookie");
  }

  // If no token, just continue
  if (!token) {
    console.log("Token Debug - No token found");
    return next();
  }

  try {
    // Debug token header before verification
    try {
      const tokenParts = token.split(".");
      if (tokenParts.length === 3) {
        const headerBase64 = tokenParts[0];
        const headerJson = Buffer.from(headerBase64, "base64").toString();
        const header = JSON.parse(headerJson);
        console.log("Token Debug - Header:", header);
        console.log("Token Debug - Algorithm:", header.alg);

        // Also decode payload for debugging
        const payloadBase64 = tokenParts[1];
        const payloadJson = Buffer.from(payloadBase64, "base64").toString();
        const payload = JSON.parse(payloadJson);
        console.log("Token Debug - Payload:", payload);
      }
    } catch (parseErr) {
      console.error("Token Debug - Error parsing token:", parseErr.message);
    }

    // Try to verify without algorithm restriction
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log(
        "Token Debug - Verification succeeded without algorithm restriction"
      );
    } catch (err) {
      console.error(
        "Token Debug - Verification failed without restriction:",
        err.message
      );
    }
  } catch (err) {
    console.error("Token Debug - Error:", err.message);
  }

  // Always continue to the next middleware
  next();
};
