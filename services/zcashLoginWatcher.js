const ZingoProcess = require("../utils/zingo/ZingoProcess.js"); // adjust path to your actual file
const prisma = require("../prisma/client.js");
const crypto = require("crypto");

const POLL_INTERVAL_MS = 15000;
const MEMO_PREFIX = "ZECBOUNTIES-LOGIN:";

let loginWallet = null;
let loginAddress = null;

async function initLoginWatcher() {
  loginWallet = new ZingoProcess({
    chain: process.env.LOGIN_WALLET_CHAIN || "mainnet",
    serverUrl: process.env.ZCASH_SERVER_URL,
    dataDir: process.env.LOGIN_WALLET_DATA_DIR, // dedicated system wallet, separate from admin payout wallets
  });

  await new Promise((r) => setTimeout(r, 3000)); // let zingo-cli boot

  const addresses = await loginWallet.addresses("addresses");
  console.log("Login wallet addresses() raw output:", addresses); // TEMP: log once, then tighten extractShieldedAddress below
  loginAddress = extractShieldedAddress(addresses);

  setInterval(pollForLogins, POLL_INTERVAL_MS);
  console.log(`🔑 Zcash login watcher started — address: ${loginAddress}`);
}

function extractShieldedAddress(addresses) {
  // Placeholder — confirm against the logged output above, then simplify.
  if (Array.isArray(addresses)) {
    const entry = addresses[0].encoded_address
      ? addresses[0].encoded_address
      : addresses.encoded_address;
    return entry;
  }
  return addresses?.address;
}

async function pollForLogins() {
  try {
    await loginWallet.sync("sync status");
    const txs = await loginWallet.transactions();

    for (const tx of txs) {
      const memo = findMemo(tx);
      if (!memo || !memo.startsWith(MEMO_PREFIX)) continue;

      const challengeId = memo.slice(MEMO_PREFIX.length).trim();
      const challenge = await prisma.zcashLoginChallenge.findUnique({
        where: { id: challengeId },
      });
      if (!challenge || challenge.status !== "PENDING") continue;

      if (new Date() > challenge.expiresAt) {
        await prisma.zcashLoginChallenge.update({
          where: { id: challengeId },
          data: { status: "EXPIRED" },
        });
        continue;
      }

      await confirmChallenge(challenge, tx);
    }
  } catch (err) {
    console.error("Zcash login watcher poll error:", err);
  }
}

function findMemo(tx) {
  // transactions() shapes vary by parseTransactionBlock output — check for these field names first,
  // adjust once you've seen a real memo come through.
  if (typeof tx.memo === "string") return tx.memo;
  if (Array.isArray(tx.memos)) return tx.memos[0];
  for (const key of Object.keys(tx)) {
    if (Array.isArray(tx[key])) {
      for (const inner of tx[key]) {
        if (inner?.memo) return inner.memo;
      }
    }
  }
  return null;
}

async function confirmChallenge(challenge, tx) {
  const senderAddress = tx.address || tx.from_address || null;

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ z_address: senderAddress }, { UA_address: senderAddress }],
    },
  });

  if (!user) {
    // No account linked to this address yet — surface to frontend so it can offer account creation.
    await prisma.zcashLoginChallenge.update({
      where: { id: challenge.id },
      data: { status: "UNLINKED", senderAddress },
    });
    return;
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  // TODO: swap for whatever session-issuing helper your seed-phrase login already uses,
  // so both flows produce identical session records.

  await prisma.zcashLoginChallenge.update({
    where: { id: challenge.id },
    data: { status: "CONFIRMED", sessionToken, userId: user.id, senderAddress },
  });
}

function getLoginAddress() {
  return loginAddress;
}

module.exports = { initLoginWatcher, getLoginAddress };
