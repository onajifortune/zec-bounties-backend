import { CoinBase, LWInstance } from "./coin.js";

export class ZcashTestCoin extends CoinBase {
  constructor() {
    super();

    this.coin = 0;
    this.name = "Zcash Test";
    this.app = "ZWallet";
    this.symbol = "ⓩ"; // \u24E9
    this.currency = "zcash";
    this.coinIndex = 133;
    this.ticker = "ZEC";
    this.dbName = "zec-test.db";
    this.marketTicker = "ZECUSDT";
    this.image = "assets/zcash.png"; // replace with image loader if needed

    this.lwd = [
      new LWInstance("Lightwalletd", "https://testnet.lightwalletd.com:9067"),
    ];

    this.defaultAddrMode = 0;
    this.defaultUAType = 7; // TSO
    this.supportsUA = true;
    this.supportsMultisig = false;
    this.supportsLedger = false;
    this.weights = [0.05, 0.25, 2.5];
    this.blockExplorers = ["https://explorer.zcha.in/transactions"];
  }
}
