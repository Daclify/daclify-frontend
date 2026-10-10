import { PrivateKey } from '@wharfkit/antelope';
import {
  RecoveryKitSchema,
  type RecoveryKit,
  VaultEnvelopeSchema,
  VaultSecretsSchema,
  EncryptionPublicKeySchema,
  EncryptionPrivateKeySchema,
  ContentEnvelopeSchema,
  EpochGrantSchema,
  type VaultEnvelope,
  type VaultSecrets,
  type EncryptionPublicKey,
  type EncryptionPrivateKey,
  type ContentEnvelope,
  type EpochGrant,
} from '@daclify/core-protocol';
export interface CreatedVault {
  localEnvelope: VaultEnvelope;
  recoveryEnvelope: VaultEnvelope;
  recoveryCredential: string;
  signingPublicKey: string;
  encryptionPublicKey: EncryptionPublicKey;
}
const text = new TextEncoder();
const ITERATIONS = 600_000;
function bytes(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}
function base64(value: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < value.length; start += 0x8000)
    binary += String.fromCharCode(...value.subarray(start, start + 0x8000));
  return btoa(binary);
}
export function generateVaultPassword(): string {
  const raw = base64(crypto.getRandomValues(new Uint8Array(18)));
  return raw.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decode(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
async function publicCoordinates(key: CryptoKey): Promise<EncryptionPublicKey> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return EncryptionPublicKeySchema.parse({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
}
async function privateCoordinates(key: CryptoKey): Promise<EncryptionPrivateKey> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return EncryptionPrivateKeySchema.parse({
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    d: jwk.d,
  });
}
async function passwordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  if (salt.length !== 16) throw new Error('Invalid vault salt');
  const input = await crypto.subtle.importKey('raw', text.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations },
    input,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
async function protect(secrets: VaultSecrets, password: string): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytes(iv), additionalData: text.encode('daclify.vault.v1') },
    key,
    text.encode(JSON.stringify(secrets)),
  );
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  };
}
export async function createVault(password: string): Promise<CreatedVault> {
  if (password.length < 12) throw new Error('Use at least 12 characters');
  const signing = PrivateKey.generate('K1');
  const encryption = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const encryptionPublicKey = await publicCoordinates(encryption.publicKey);
  const encryptionPrivateKey = await privateCoordinates(encryption.privateKey);
  const secrets = VaultSecretsSchema.parse({
    signingKey: signing.toString(),
    encryptionPrivateKey,
  });
  const recoveryCredential = base64(crypto.getRandomValues(new Uint8Array(32)));
  return {
    localEnvelope: await protect(secrets, password),
    recoveryEnvelope: await protect(secrets, recoveryCredential),
    recoveryCredential,
    signingPublicKey: signing.toPublic().toString(),
    encryptionPublicKey,
  };
}
export async function unlockVault(
  envelope: VaultEnvelope,
  password: string,
): Promise<VaultSecrets> {
  try {
    const value = VaultEnvelopeSchema.parse(envelope);
    const iv = decode(value.iv);
    if (iv.length !== 12) throw new Error('Invalid nonce');
    const key = await passwordKey(password, decode(value.salt), value.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(iv), additionalData: text.encode('daclify.vault.v1') },
      key,
      bytes(decode(value.ciphertext)),
    );
    return VaultSecretsSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error('VAULT_UNLOCK_FAILED');
  }
}
export async function recoverVault(
  envelope: VaultEnvelope,
  credential: string,
): Promise<VaultSecrets> {
  return unlockVault(envelope, credential);
}
export async function sealContent(
  data: Uint8Array,
  keyBytes: Uint8Array,
  domain: string,
): Promise<ContentEnvelope> {
  if (keyBytes.length !== 32 || data.byteLength > 25_000_000 || !domain)
    throw new Error('Invalid content boundary');
  const key = await crypto.subtle.importKey('raw', bytes(keyBytes), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: bytes(iv), additionalData: text.encode(`daclify.content.v1:${domain}`) },
    key,
    bytes(data),
  );
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  };
}
export async function openContent(
  envelope: ContentEnvelope,
  keyBytes: Uint8Array,
  domain: string,
): Promise<Uint8Array> {
  const value = ContentEnvelopeSchema.parse(envelope);
  const iv = decode(value.iv);
  if (iv.length !== 12 || keyBytes.length !== 32 || !domain)
    throw new Error('Invalid encryption envelope');
  const key = await crypto.subtle.importKey('raw', bytes(keyBytes), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes(iv),
        additionalData: text.encode(`daclify.content.v1:${domain}`),
      },
      key,
      bytes(decode(value.ciphertext)),
    ),
  );
}
async function deriveWrapKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
  domain: string,
): Promise<Uint8Array> {
  if (salt.length !== 32 || !domain) throw new Error('Invalid epoch domain');
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const input = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: bytes(salt),
        info: text.encode(`daclify.epoch.v1:${domain}`),
      },
      input,
      256,
    ),
  );
}
export async function createEpochGrant(
  recipient: EncryptionPublicKey,
  epoch: Uint8Array,
  domain: string,
): Promise<EpochGrant> {
  if (epoch.length !== 32) throw new Error('Invalid epoch key');
  const target = await crypto.subtle.importKey(
    'jwk',
    EncryptionPublicKeySchema.parse(recipient),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const wrappingKey = await deriveWrapKey(ephemeral.privateKey, target, salt, domain);
  return {
    version: 1,
    ephemeralKey: await publicCoordinates(ephemeral.publicKey),
    salt: base64(salt),
    envelope: await sealContent(epoch, wrappingKey, domain),
  };
}
export async function openEpochGrant(
  recipient: EncryptionPrivateKey,
  grant: EpochGrant,
  domain: string,
): Promise<Uint8Array> {
  const value = EpochGrantSchema.parse(grant);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    EncryptionPrivateKeySchema.parse(recipient),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const ephemeral = await crypto.subtle.importKey(
    'jwk',
    value.ephemeralKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const wrappingKey = await deriveWrapKey(privateKey, ephemeral, decode(value.salt), domain);
  const epoch = await openContent(value.envelope, wrappingKey, domain);
  if (epoch.length !== 32) throw new Error('Invalid recovered epoch');
  return epoch;
}

export async function restoreRecoveryKit(
  input: unknown,
  credential: string,
  password: string,
): Promise<RecoveryKit> {
  if (password.length < 12) throw new Error('Use at least 12 characters');
  try {
    const kit = RecoveryKitSchema.parse(input);
    let recovered: VaultSecrets;
    try {
      recovered = await recoverVault(kit.recoveryEnvelope, credential);
    } catch {
      recovered = await unlockVault(kit.localEnvelope, credential);
    }
    const publicSigning = PrivateKey.from(recovered.signingKey).toPublic().toString();
    const publicEncryption = EncryptionPublicKeySchema.parse({
      kty: recovered.encryptionPrivateKey.kty,
      crv: recovered.encryptionPrivateKey.crv,
      x: recovered.encryptionPrivateKey.x,
      y: recovered.encryptionPrivateKey.y,
    });
    if (
      publicSigning !== kit.signingPublicKey ||
      JSON.stringify(publicEncryption) !== JSON.stringify(kit.encryptionPublicKey)
    )
      throw new Error('Key mismatch');
    return RecoveryKitSchema.parse({ ...kit, localEnvelope: await protect(recovered, password) });
  } catch {
    throw new Error('VAULT_UNLOCK_FAILED');
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(data))), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
export async function openCommittedEpoch(
  recipient: EncryptionPrivateKey,
  grant: EpochGrant,
  domain: string,
  commitment: string,
): Promise<Uint8Array> {
  const key = await openEpochGrant(recipient, grant, domain);
  if ((await sha256Hex(key)) !== commitment) throw new Error('EPOCH_KEY_MISMATCH');
  return key;
}
