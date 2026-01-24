import { CoinBase, LWInstance } from "./coin.js";

export class YcashCoin extends CoinBase {
  constructor() {
    super();

    this.coin = 1;
    this.name = "Ycash";
    this.app = "YWallet";
    this.symbol = "ⓨ"; // \u24E8
    this.currency = "ycash";
    this.coinIndex = 347;
    this.ticker = "YEC";
    this.dbName = "yec.db";
    this.marketTicker = null;
    this.image = "assets/ycash.png"; // Replace with image handling if needed

    this.lwd = [new LWInstance("Lightwalletd", "https://lite.ycash.xyz:9067")];

    this.defaultAddrMode = 2;
    this.defaultUAType = 2;
    this.supportsUA = false;
    this.supportsMultisig = true;
    this.supportsLedger = false;
    this.weights = [5, 25, 250];
    this.blockExplorers = ["https://yecblockexplorer.com/tx"];
  }
}
