// server/models/portfolio.js
const mongoose = require("mongoose");

const PortfolioSnapshotSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    required: true,
  },
  totalValue: {
    type: Number,
    required: true,
  },
  paperBalance: {
    type: Number,
    required: true,
  },
});

const PortfolioSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  // Daily snapshots (last 30 days)
  dailySnapshots: [PortfolioSnapshotSchema],
  // Weekly snapshots (last 52 weeks)
  weeklySnapshots: [PortfolioSnapshotSchema],
  // Monthly snapshots (last 24 months)
  monthlySnapshots: [PortfolioSnapshotSchema],
  // Yearly snapshots (all years)
  yearlySnapshots: [PortfolioSnapshotSchema],
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Portfolio", PortfolioSchema);
