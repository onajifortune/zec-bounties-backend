import { CoinBase, LWInstance } from "./coin.js";

export class ZcashCoin extends CoinBase {
  constructor() {
    super();

    this.coin = 0;
    this.name = "Zcash";
    this.app = "ZWallet";
    this.symbol = "ⓩ"; // \u24E9
    this.currency = "zcash";
    this.coinIndex = 133;
    this.ticker = "ZEC";
    this.dbName = "zec.db";
    this.marketTicker = "ZECUSDT";
    this.image = "assets/zcash.png"; // Replace with your image handling if needed

    this.lwd = [
      new LWInstance("Zec.rocks (Global)", "https://zec.rocks:443"),
      new LWInstance("Zcash Infra (USA)", "https://lwd1.zcash-infra.com:9067"),
      new LWInstance("Zcash Infra (HK)", "https://lwd2.zcash-infra.com:9067"),
      new LWInstance("Zcash Infra (USA)", "https://lwd3.zcash-infra.com:9067"),
      new LWInstance(
        "Zcash Infra (Canada)",
        "https://lwd4.zcash-infra.com:9067"
      ),
      new LWInstance(
        "Zcash Infra (France)",
        "https://lwd5.zcash-infra.com:9067"
      ),
      new LWInstance("Zcash Infra (USA)", "https://lwd6.zcash-infra.com:9067"),
      new LWInstance(
        "Zcash Infra (Brazil)",
        "https://lwd7.zcash-infra.com:9067"
      ),
      new LWInstance("Zec.rocks (NA)", "https://na.zec.rocks:443"),
      new LWInstance("Zec.rocks (SA)", "https://sa.zec.rocks:443"),
      new LWInstance("Zec.rocks (EU)", "https://eu.zec.rocks:443"),
      new LWInstance("Zec.rocks (AP)", "https://ap.zec.rocks:443"),
    ];

    this.defaultAddrMode = 0;
    this.defaultUAType = 7; // TSO
    this.supportsUA = true;
    this.supportsMultisig = false;
    this.supportsLedger = true;
    this.weights = [0.05, 0.25, 2.5];
    this.blockExplorers = [
      "https://blockchair.com/zcash/transaction",
      "https://zecblockexplorer.com/tx",
    ];
  }
}
