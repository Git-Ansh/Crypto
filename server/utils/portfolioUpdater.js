// server/utils/portfolioUpdater.js
const Portfolio = require("../models/portfolio");
const Position = require("../models/position");
const User = require("../models/user");

// Update portfolio snapshots for all users
async function updatePortfolioSnapshots() {
  try {
    const users = await User.find({});

    for (const user of users) {
      // Get all positions for the user
      const positions = await Position.find({ user: user._id });

      // Calculate total portfolio value
      const positionsValue = positions.reduce((total, position) => {
        return total + position.amount * position.currentPrice;
      }, 0);

      const totalValue = positionsValue + user.paperBalance;

      // Find or create portfolio document
      let portfolio = await Portfolio.findOne({ user: user._id });

      if (!portfolio) {
        portfolio = new Portfolio({
          user: user._id,
          dailySnapshots: [],
          weeklySnapshots: [],
          monthlySnapshots: [],
          yearlySnapshots: [],
        });
      }

      // Create new snapshot
      const newSnapshot = {
        timestamp: new Date(),
        totalValue,
        paperBalance: user.paperBalance,
      };

      // Add to daily snapshots (keep last 30 days)
      portfolio.dailySnapshots.push(newSnapshot);
      if (portfolio.dailySnapshots.length > 30) {
        portfolio.dailySnapshots.shift();
      }

      // Check if we need to update weekly snapshot (every 7 days)
      const lastWeeklySnapshot =
        portfolio.weeklySnapshots[portfolio.weeklySnapshots.length - 1];
      if (
        !lastWeeklySnapshot ||
        new Date() - new Date(lastWeeklySnapshot.timestamp) >
          7 * 24 * 60 * 60 * 1000
      ) {
        portfolio.weeklySnapshots.push(newSnapshot);
        // Keep last 52 weeks
        if (portfolio.weeklySnapshots.length > 52) {
          portfolio.weeklySnapshots.shift();
        }
      }

      // Check if we need to update monthly snapshot (every 30 days)
      const lastMonthlySnapshot =
        portfolio.monthlySnapshots[portfolio.monthlySnapshots.length - 1];
      if (
        !lastMonthlySnapshot ||
        new Date() - new Date(lastMonthlySnapshot.timestamp) >
          30 * 24 * 60 * 60 * 1000
      ) {
        portfolio.monthlySnapshots.push(newSnapshot);
        // Keep last 24 months
        if (portfolio.monthlySnapshots.length > 24) {
          portfolio.monthlySnapshots.shift();
        }
      }

      // Check if we need to update yearly snapshot (every 365 days)
      const lastYearlySnapshot =
        portfolio.yearlySnapshots[portfolio.yearlySnapshots.length - 1];
      if (
        !lastYearlySnapshot ||
        new Date() - new Date(lastYearlySnapshot.timestamp) >
          365 * 24 * 60 * 60 * 1000
      ) {
        portfolio.yearlySnapshots.push(newSnapshot);
        // Keep all yearly snapshots
      }

      portfolio.lastUpdated = new Date();
      await portfolio.save();
    }

    console.log("Portfolio snapshots updated successfully");
  } catch (err) {
    console.error("Error updating portfolio snapshots:", err);
  }
}

module.exports = { updatePortfolioSnapshots };
