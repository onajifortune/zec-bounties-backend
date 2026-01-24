import { CoinBase } from "./coin.js";
import { YcashCoin } from "./ycash.js";
import { ZcashCoin } from "./zcash.js";
import { ZcashTestCoin } from "./zcashtest.js";

// Instantiate coin objects
const ycash = new YcashCoin();
const zcash = new ZcashCoin();
const zcashtest = new ZcashTestCoin();

// Array of active coins
const coins = [zcash, ycash];

// Activation date
const activationDate = new Date(2018, 9, 29); // JS months are 0-indexed (October = 9)

export { ycash, zcash, zcashtest, coins, activationDate };
