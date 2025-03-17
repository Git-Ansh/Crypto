// server/models/botConfig.js
const mongoose = require("mongoose");

const BotRoadmapItemSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  plan: {
    type: String,
    required: true,
  },
  completed: {
    type: Boolean,
    default: false,
  },
});

const BotConfigSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
  strategy: {
    type: String,
    default: "Aggressive Growth",
  },
  riskLevel: {
    type: Number,
    default: 50, // 0-100 scale
  },
  tradesPerDay: {
    type: Number,
    default: 8,
  },
  autoRebalance: {
    type: Boolean,
    default: true,
  },
  dcaEnabled: {
    type: Boolean,
    default: true,
  },
  roadmap: [BotRoadmapItemSchema],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("BotConfig", BotConfigSchema);
