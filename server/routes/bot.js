const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const User = require("../models/user");
const BotConfig = require("../models/botConfig");

// Get bot configuration
router.get("/config", auth, async (req, res) => {
  try {
    console.log("Fetching bot config for user:", req.user.id);
    let botConfig = await BotConfig.findOne({ user: req.user.id });

    // If no config exists, create default config
    if (!botConfig) {
      botConfig = new BotConfig({
        user: req.user.id,
        active: false,
        tradingPairs: ["BTC-USD", "ETH-USD"],
        maxOpenPositions: 3,
        // Using numeric risk level (50 = medium) instead of string
        riskLevel: 50,
        strategy: "trend-following",
        tradingAmount: 100,
      });
      await botConfig.save();
    }

    // Map numeric risk level to string for client display
    const response = {
      ...botConfig.toObject(),
      riskLevelLabel: getRiskLevelLabel(botConfig.riskLevel),
    };

    res.json(response);
  } catch (err) {
    console.error("Error fetching bot config:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Update bot configuration
router.put("/config", auth, async (req, res) => {
  try {
    const {
      active,
      tradingPairs,
      maxOpenPositions,
      riskLevel,
      strategy,
      tradingAmount,
    } = req.body;

    // Find existing config or create new one
    let botConfig = await BotConfig.findOne({ user: req.user.id });

    if (!botConfig) {
      botConfig = new BotConfig({ user: req.user.id });
    }

    // Update fields if provided
    if (active !== undefined) botConfig.active = active;
    if (tradingPairs) botConfig.tradingPairs = tradingPairs;
    if (maxOpenPositions) botConfig.maxOpenPositions = maxOpenPositions;

    // Convert string risk level to number if needed
    if (riskLevel !== undefined) {
      if (typeof riskLevel === "string") {
        botConfig.riskLevel = mapRiskLevelToNumber(riskLevel);
      } else {
        botConfig.riskLevel = riskLevel;
      }
    }

    if (strategy) botConfig.strategy = strategy;
    if (tradingAmount) botConfig.tradingAmount = tradingAmount;

    await botConfig.save();

    // Add string representation of risk level for client
    const response = {
      ...botConfig.toObject(),
      riskLevelLabel: getRiskLevelLabel(botConfig.riskLevel),
    };

    res.json(response);
  } catch (err) {
    console.error("Error updating bot config:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// Helper function to map numeric risk level to string
function getRiskLevelLabel(riskLevel) {
  if (riskLevel < 25) return "low";
  if (riskLevel < 75) return "medium";
  return "high";
}

// Helper function to map string risk level to number
function mapRiskLevelToNumber(riskLevelString) {
  switch (riskLevelString.toLowerCase()) {
    case "low":
      return 10;
    case "medium":
      return 50;
    case "high":
      return 90;
    default:
      return 50;
  }
}

module.exports = router;
