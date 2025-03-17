// server/models/position.js
const mongoose = require("mongoose");

const PositionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  symbol: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    default: 0,
  },
  averageEntryPrice: {
    type: Number,
    required: true,
  },
  currentPrice: {
    type: Number,
    required: true,
  },
  profitLoss: {
    type: Number,
    required: true,
    default: 0,
  },
  profitLossPercentage: {
    type: Number,
    required: true,
    default: 0,
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
  },
});

// Compound index to ensure a user can only have one position per symbol
PositionSchema.index({ user: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model("Position", PositionSchema);
