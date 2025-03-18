// server/routes/botConfig.js
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const BotConfig = require("../models/botConfig");

// Get bot configuration
router.get("/", auth, async (req, res) => {
  try {
    let botConfig = await BotConfig.findOne({ user: req.user.id });

    if (!botConfig) {
      // Create default bot config if it doesn't exist
      botConfig = new BotConfig({
        user: req.user.id,
        active: false,
        strategy: "Aggressive Growth",
        riskLevel: 50,
        tradesPerDay: 8,
        autoRebalance: true,
        dcaEnabled: true,
        roadmap: [],
      });
      await botConfig.save();
    }

    res.json(botConfig);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Update bot configuration
router.put("/", auth, async (req, res) => {
  try {
    const {
      active,
      strategy,
      riskLevel,
      tradesPerDay,
      autoRebalance,
      dcaEnabled,
    } = req.body;

    // Build bot config object
    const botConfigFields = {};
    if (active !== undefined) botConfigFields.active = active;
    if (strategy) botConfigFields.strategy = strategy;
    if (riskLevel !== undefined) botConfigFields.riskLevel = riskLevel;
    if (tradesPerDay !== undefined) botConfigFields.tradesPerDay = tradesPerDay;
    if (autoRebalance !== undefined)
      botConfigFields.autoRebalance = autoRebalance;
    if (dcaEnabled !== undefined) botConfigFields.dcaEnabled = dcaEnabled;
    botConfigFields.updatedAt = Date.now();

    let botConfig = await BotConfig.findOne({ user: req.user.id });

    if (botConfig) {
      // Update
      botConfig = await BotConfig.findOneAndUpdate(
        { user: req.user.id },
        { $set: botConfigFields },
        { new: true }
      );
    } else {
      // Create
      botConfig = new BotConfig({
        user: req.user.id,
        ...botConfigFields,
      });
      await botConfig.save();
    }

    res.json(botConfig);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Get bot roadmap
router.get("/roadmap", auth, async (req, res) => {
  try {
    const botConfig = await BotConfig.findOne({ user: req.user.id });

    if (!botConfig) {
      return res.status(404).json({ message: "Bot configuration not found" });
    }

    res.json(botConfig.roadmap);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

// Update bot roadmap
router.put("/roadmap", auth, async (req, res) => {
  try {
    const { roadmap } = req.body;

    if (!Array.isArray(roadmap)) {
      return res.status(400).json({ message: "Roadmap must be an array" });
    }

    const botConfig = await BotConfig.findOne({ user: req.user.id });

    if (!botConfig) {
      return res.status(404).json({ message: "Bot configuration not found" });
    }

    botConfig.roadmap = roadmap;
    botConfig.updatedAt = Date.now();
    await botConfig.save();

    res.json(botConfig.roadmap);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
