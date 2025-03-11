// server/middleware/errorHandler.js
const CustomError = require("../Server/utils/CustomError");

/**
 * Centralized error handling middleware.
 * @param {Error} err - The error object.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 */
const errorHandler = (err, req, res, next) => {
  console.error("Error:", err);
  
  if (err instanceof CustomError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  // Fallback
  res.status(500).json({
    success: false,
    message: "Server Error",
  });
};

module.exports = errorHandler;
