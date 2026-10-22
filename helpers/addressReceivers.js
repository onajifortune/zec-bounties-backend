// Receiver flags for the public profile icons. The raw address string is never
// returned to visitors (see publicProfileAddress.js); these three booleans are
// the only thing the icons need.
//
// Exact Unified Address flags come from @elemental-zcash/zaddr_wasm_parser when
// it can be loaded. Without it, a lone Sapling address is still exact, and a
// Unified Address falls back to the common Orchard+Sapling shape so visitors
// do not see every receiver as missing.

const EMPTY = { ironwood: false, sapling: false, transparent: false };

let decoderPromise = null;

function loadDecoder() {
  if (!decoderPromise) {
    decoderPromise = import("@elemental-zcash/zaddr_wasm_parser")
      .then((mod) => mod)
      .catch(() => null);
  }
  return decoderPromise;
}

function fromWasm(result) {
  if (!result || typeof result !== "object") return null;
  const ironwood = !!(result.orchard || result.ironwood);
  const sapling = !!result.sapling;
  const transparent = !!(result.p2pkh || result.p2sh || result.tex || result.transparent);
  return { ironwood, sapling, transparent };
}

function fallback(user) {
  const ua = typeof user?.UA_address === "string" && user.UA_address.startsWith("u1");
  const z = typeof user?.z_address === "string" && user.z_address.length > 0;
  if (ua) {
    // Common modern UA (Zashi / YWallet / Zingo). Exact flags replace this
    // when the WASM decoder is available.
    return { ironwood: true, sapling: true, transparent: false };
  }
  if (z) return { ironwood: false, sapling: true, transparent: false };
  return { ...EMPTY };
}

async function receiversForUser(user) {
  if (!user) return { ...EMPTY };
  const addr = user.UA_address || user.z_address || "";
  if (!addr) return { ...EMPTY };

  const mod = await loadDecoder();
  const fn = mod?.get_address_receivers || mod?.getAddressReceivers;
  if (typeof fn === "function") {
    try {
      const decoded = fromWasm(fn(addr));
      if (decoded) return decoded;
    } catch {
      // Invalid or undecodable address: fall through.
    }
  }
  return fallback(user);
}

module.exports = { receiversForUser, EMPTY };
