const express = require("express");
const axios = require("axios");
const router = express.Router();

const CRYPTOAPIS_API_KEY = "9dd2393b1d1eaa27410d02c22c477c29b575f728";
const CRYPTOAPIS_REST_API = "https://api.cryptoapis.io/v2";

// Proxy endpoint for quotes
router.get("/quotes/current", async (req, res) => {
  try {
    const symbol = req.query.symbol;
    console.log(`Fetching quote for ${symbol}`);
    const response = await axios.get(
      `${CRYPTOAPIS_REST_API}/markets/quotes/current`,
      {
        params: { symbol, apikey: CRYPTOAPIS_API_KEY },
        headers: { Accept: "application/json" },
      }
    );
    console.log("CryptoAPI response:", JSON.stringify(response.data));

    // Format the response to match what the frontend expects
    res.json({
      data: {
        price: response.data?.data?.item?.price || response.data?.price || 0,
        symbol: symbol,
      },
    });
  } catch (error) {
    console.error(
      "CryptoAPI proxy error:",
      error.response?.data || error.message
    );

    // Return fallback data for development
    res.json({
      data: {
        price: getFallbackPrice(symbol.replace("USD", "")),
        symbol: symbol,
      },
    });
  }
});

// Proxy endpoint for OHLC data
router.get("/ohlc", async (req, res) => {
  try {
    const response = await axios.get(`${CRYPTOAPIS_REST_API}/markets/ohlc`, {
      params: { ...req.query, apikey: CRYPTOAPIS_API_KEY },
      headers: { Accept: "application/json" },
    });
    res.json(response.data);
  } catch (error) {
    console.error(
      "CryptoAPI proxy error:",
      error.response?.data || error.message
    );
    res
      .status(error.response?.status || 500)
      .json(error.response?.data || { error: error.message });
  }
});

// Helper function to provide fallback prices for development
function getFallbackPrice(symbol) {
  const fallbackPrices = {
    BTC: 65001,
    ETH: 3500,
    XRP: 0.55,
    LTC: 80,
    BCH: 250,
    ADA: 0.45,
    DOT: 6.5,
    LINK: 15,
    XLM: 0.12,
    DOGE: 0.08,
  };
  return fallbackPrices[symbol] || 100;
}

module.exports = router;
