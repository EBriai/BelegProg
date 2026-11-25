// libsodium "sealed box" (crypto_box_seal), nodig om een GitHub-secret te zetten.
// Gebruikt tweetnacl (window.nacl) en blake2b (window.blake2b).
window.Beleg = window.Beleg || {};
Beleg.sealedBox = (pubKeyB64, message) => {
  const pk = Uint8Array.from(atob(pubKeyB64), (c) => c.charCodeAt(0));
  const eph = nacl.box.keyPair();
  const nonceInput = new Uint8Array(64); nonceInput.set(eph.publicKey); nonceInput.set(pk, 32);
  const nonce = blake2b(nonceInput, undefined, 24);
  const ct = nacl.box(new TextEncoder().encode(message), nonce, pk, eph.secretKey);
  const out = new Uint8Array(32 + ct.length); out.set(eph.publicKey); out.set(ct, 32);
  return btoa(String.fromCharCode(...out));
};
