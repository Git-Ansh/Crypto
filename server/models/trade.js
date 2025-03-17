// server/models/Trade.js
const mongoose = require("mongoose");

const TradeSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  type: {
    type: String,
    enum: ["buy", "sell"],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  symbol: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  total: {
    type: Number,
    required: true,
  },
  executedBy: {
    type: String,
    enum: ["user", "bot"],
    default: "user",
  },
  status: {
    type: String,
    enum: ["pending", "completed", "failed", "canceled"],
    default: "completed",
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Trade", TradeSchema);
