const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const Position = require("../models/position");
const User = require("../models/user");

// Get all positions for the authenticated user
router.get("/", auth, async (req, res) => {
  try {
    console.log("Fetching positions for user:", req.user.id);
    const positions = await Position.find({ user: req.user.id });
    res.json(positions);
  } catch (err) {
    console.error("Error fetching positions:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Get a specific position by ID
router.get("/:id", auth, async (req, res) => {
  try {
    const position = await Position.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!position) {
      return res.status(404).json({ message: "Position not found" });
    }

    res.json(position);
  } catch (err) {
    console.error("Error fetching position:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Update position (for price updates)
router.put("/:id", auth, async (req, res) => {
  try {
    const { currentPrice } = req.body;

    if (!currentPrice) {
      return res.status(400).json({ message: "Current price is required" });
    }

    const position = await Position.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!position) {
      return res.status(404).json({ message: "Position not found" });
    }

    // Update price and calculate profit/loss
    position.currentPrice = currentPrice;
    position.profitLoss =
      (position.currentPrice - position.averageEntryPrice) * position.amount;
    position.profitLossPercentage =
      (position.currentPrice / position.averageEntryPrice - 1) * 100;
    position.lastUpdated = Date.now();

    await position.save();

    res.json(position);
  } catch (err) {
    console.error("Error updating position:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
