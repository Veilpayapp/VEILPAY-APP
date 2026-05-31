import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

export interface EncryptedNote {
  nonce: string; // base64
  ciphertext: string; // base64
}

/**
 * Generates an ephemeral Curve25519 keypair for encryption purposes.
 */
export function generateEphemeralKeyPair() {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
}

/**
 * Encrypts a plaintext memo for a specific recipient using NaCl Box (Curve25519-XSalsa20-Poly1305).
 * 
 * @param memo The plaintext message
 * @param recipientPublicKey The receiver's public key (32 bytes)
 * @param senderSecretKey The sender's private key (32 bytes)
 */
export function encryptNote(
  memo: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array
): EncryptedNote {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = Buffer.from(memo, 'utf8');
  
  const encryptedMessage = nacl.box(
    messageUint8,
    nonce,
    recipientPublicKey,
    senderSecretKey
  );

  return {
    nonce: Buffer.from(nonce).toString('base64'),
    ciphertext: Buffer.from(encryptedMessage).toString('base64'),
  };
}

/**
 * Decrypts an encrypted memo using the recipient's secret key and the sender's public key.
 */
export function decryptNote(
  encryptedNote: EncryptedNote,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array
): string | null {
  const nonce = Buffer.from(encryptedNote.nonce, 'base64');
  const ciphertext = Buffer.from(encryptedNote.ciphertext, 'base64');

  const decryptedMessage = nacl.box.open(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientSecretKey
  );

  if (!decryptedMessage) {
    return null;
  }

  return Buffer.from(decryptedMessage).toString('utf8');
}
