import sodium from "libsodium-wrappers";

const KEY = "mess.identity.v1";
const V = () => sodium.base64_variants.URLSAFE_NO_PADDING;

// ফোনেই Ed25519 চাবির জোড়া তৈরি হয়। ID = পাবলিক কী। (v0.1.0: সিক্রেট কী এখনো সাধারণ স্টোরেজে)
export async function loadOrCreateIdentity() {
  await sodium.ready;
  const saved = localStorage.getItem(KEY);
  if (saved) {
    const { pk, sk } = JSON.parse(saved);
    return { id: pk, sk: sodium.from_base64(sk, V()) };
  }
  const kp = sodium.crypto_sign_keypair();
  const pk = sodium.to_base64(kp.publicKey, V());
  localStorage.setItem(KEY, JSON.stringify({ pk, sk: sodium.to_base64(kp.privateKey, V()) }));
  return { id: pk, sk: kp.privateKey };
}
