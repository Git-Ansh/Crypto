// server/routes/trades.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Trade = require("../models/trade");
const Position = require("../models/position");
const User = require("../models/user");
const { check, validationResult } = require("express-validator");
const { tradesLimiter } = require("../middleware/rateLimiter"); // Import the trades-specific limiter

// Get all trades for a user - use the trades-specific limiter
router.get("/", [auth, tradesLimiter], async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user.id })
      .sort({ timestamp: -1 })
      .limit(50);

    // Add cache headers to reduce repeated requests
    res.set("Cache-Control", "private, max-age=30"); // Cache for 30 seconds
    res.json(trades);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Get recent trades (last 10)
router.get("/recent", auth, async (req, res) => {
  try {
    const trades = await Trade.find({ user: req.user.id })
      .sort({ timestamp: -1 })
      .limit(10);
    res.json(trades);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Execute a trade (buy or sell)
router.post(
  "/execute",
  [
    auth,
    [
      check("type", "Type is required").not().isEmpty(),
      check("symbol", "Symbol is required").not().isEmpty(),
      check("amount", "Amount is required").isNumeric(),
      check("price", "Price is required").isNumeric(),
    ],
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { type, symbol, amount, price, executedBy = "user" } = req.body;
    const total = amount * price;

    try {
      const user = await User.findById(req.user.id);

      // For buy orders, check if user has enough balance
      if (type === "buy" && user.paperBalance < total) {
        return res.status(400).json({ message: "Insufficient funds" });
      }

      // For sell orders, check if user has enough of the asset
      if (type === "sell") {
        const position = await Position.findOne({ user: req.user.id, symbol });
        if (!position || position.amount < amount) {
          return res.status(400).json({ message: "Insufficient assets" });
        }
      }

      // Create the trade
      const newTrade = new Trade({
        user: req.user.id,
        type,
        symbol,
        amount,
        price,
        total,
        executedBy,
        status: "completed",
      });

      // Update user balance
      if (type === "buy") {
        user.paperBalance -= total;
      } else {
        user.paperBalance += total;
      }
      await user.save();

      // Update or create position
      let position = await Position.findOne({ user: req.user.id, symbol });

      if (type === "buy") {
        if (position) {
          // Update existing position
          const newTotalAmount = position.amount + parseFloat(amount);
          const newTotalCost =
            position.averageEntryPrice * position.amount + total;
          position.averageEntryPrice = newTotalCost / newTotalAmount;
          position.amount = newTotalAmount;
        } else {
          // Create new position
          position = new Position({
            user: req.user.id,
            symbol,
            amount: parseFloat(amount),
            averageEntryPrice: price,
            currentPrice: price,
            profitLoss: 0,
            profitLossPercentage: 0,
          });
        }
      } else {
        // Sell
        position.amount -= parseFloat(amount);
        // If position is completely sold, calculate profit/loss
        if (position.amount <= 0) {
          await Position.deleteOne({ _id: position._id });
        } else {
          await position.save();
        }
      }

      if (position && position.amount > 0) {
        position.currentPrice = price;
        position.profitLoss =
          (position.currentPrice - position.averageEntryPrice) *
          position.amount;
        position.profitLossPercentage =
          (position.currentPrice / position.averageEntryPrice - 1) * 100;
        position.lastUpdated = Date.now();
        await position.save();
      }

      await newTrade.save();
      res.json(newTrade);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server Error");
    }
  }
);

module.exports = router;
