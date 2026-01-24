import fs from "fs/promises";
import path from "path";
import os from "os";

// Simulates your LWInstance class
export class LWInstance {
  constructor(name, url) {
    this.name = name;
    this.url = url;
  }
}

// Base class for coins
export class CoinBase {
  constructor() {
    // must be set in subclass
    this.dbName = "";
    this.dbDir = "";
    this.dbFullPath = "";
  }

  // Getter placeholders for subclass to override
  get name() {
    throw new Error("Not implemented");
  }
  get coin() {
    throw new Error("Not implemented");
  }
  get app() {
    throw new Error("Not implemented");
  }
  get symbol() {
    throw new Error("Not implemented");
  }
  get currency() {
    throw new Error("Not implemented");
  }
  get ticker() {
    throw new Error("Not implemented");
  }
  get coinIndex() {
    throw new Error("Not implemented");
  }
  get marketTicker() {
    return null;
  }
  get image() {
    throw new Error("Not implemented");
  }
  get lwd() {
    throw new Error("Not implemented");
  }
  get defaultAddrMode() {
    throw new Error("Not implemented");
  }
  get defaultUAType() {
    throw new Error("Not implemented");
  }
  get supportsUA() {
    throw new Error("Not implemented");
  }
  get supportsMultisig() {
    throw new Error("Not implemented");
  }
  get supportsLedger() {
    throw new Error("Not implemented");
  }
  get weights() {
    throw new Error("Not implemented");
  }
  get blockExplorers() {
    throw new Error("Not implemented");
  }

  // Initialize database paths
  init(dbDirPath) {
    this.dbDir = dbDirPath;
    this.dbFullPath = this._getFullPath(this.dbDir);
  }

  _getFullPath(dbPath) {
    return path.join(dbPath, this.dbName);
  }

  async tryImport(file) {
    // file should be an object with { name, path }
    if (file.name === this.dbName) {
      const tempDir = await CoinBase.getTempPath();
      const dest = path.join(tempDir, this.dbName);
      await fs.copyFile(file.path, dest);
      return true;
    }
    return false;
  }

  async importFromTemp() {
    const tempDir = await CoinBase.getTempPath();
    const srcPath = path.join(tempDir, this.dbName);
    console.log(`Import from ${srcPath}`);
    try {
      await fs.access(srcPath);
      console.log(`copied to ${this.dbFullPath}`);
      await this.delete();
      await fs.copyFile(srcPath, this.dbFullPath);
      await fs.unlink(srcPath);
    } catch (err) {
      // file does not exist
    }
  }

  async delete() {
    try {
      await fs.unlink(path.join(this.dbDir, this.dbName));
      await fs.unlink(path.join(this.dbDir, `${this.dbName}-shm`));
      await fs.unlink(path.join(this.dbDir, `${this.dbName}-wal`));
    } catch (e) {
      // ignore failures
    }
  }

  // Helper to get temporary directory
  static async getTempPath() {
    return os.tmpdir();
  }
}
