// server/routes/portfolio.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Portfolio = require("../models/portfolio");
const Position = require("../models/position");
const User = require("../models/user");

// Get user portfolio summary
router.get("/summary", auth, async (req, res) => {
  try {
    const portfolio = await Portfolio.findOne({ user: req.user.id });
    const positions = await Position.find({ user: req.user.id });
    const user = await User.findById(req.user.id);

    if (!portfolio) {
      return res.status(404).json({ message: "Portfolio not found" });
    }

    // Calculate total portfolio value
    const positionsValue = positions.reduce((total, position) => {
      return total + position.amount * position.currentPrice;
    }, 0);

    const totalValue = positionsValue + user.paperBalance;

    res.json({
      paperBalance: user.paperBalance,
      positionsValue,
      totalValue,
      positions,
      lastUpdated: portfolio.lastUpdated,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Get portfolio history (timeframe: 24h, 1w, 1m, 1y, all)
router.get("/history/:timeframe", auth, async (req, res) => {
  try {
    const { timeframe } = req.params;
    const portfolio = await Portfolio.findOne({ user: req.user.id });

    if (!portfolio) {
      return res.status(404).json({ message: "Portfolio not found" });
    }

    let history;
    switch (timeframe) {
      case "24h":
        // Return last 24 hours of daily snapshots
        history = portfolio.dailySnapshots.slice(-24);
        break;
      case "1w":
        // Return last 7 days of daily snapshots
        history = portfolio.dailySnapshots.slice(-7);
        break;
      case "1m":
        // Return last 30 days of daily snapshots
        history = portfolio.dailySnapshots.slice(-30);
        break;
      case "1y":
        // Return last 12 months of monthly snapshots
        history = portfolio.monthlySnapshots.slice(-12);
        break;
      case "all":
        // Return all yearly snapshots
        history = portfolio.yearlySnapshots;
        break;
      default:
        return res.status(400).json({ message: "Invalid timeframe" });
    }

    res.json(history);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Add funds to paper balance
router.post("/add-funds", auth, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findById(req.user.id);
    user.paperBalance += parseFloat(amount);
    await user.save();

    res.json({ paperBalance: user.paperBalance });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
