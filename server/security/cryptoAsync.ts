import crypto from 'node:crypto';

const MAX_CONCURRENT_KDF = 4;
const MAX_QUEUED_KDF = 16;

let activeKdfCount = 0;
const waitQueue: Array<() => void> = [];

export class KdfOverloadError extends Error {
  readonly httpCode = 503;
  constructor() {
    super('Servidor temporariamente sobrecarregado em operações criptográficas. Tente novamente em instantes.');
    this.name = 'KdfOverloadError';
  }
}

async function acquireKdfSlot(): Promise<void> {
  if (activeKdfCount < MAX_CONCURRENT_KDF) {
    activeKdfCount += 1;
    return;
  }
  if (waitQueue.length >= MAX_QUEUED_KDF) {
    throw new KdfOverloadError();
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeKdfCount += 1;
      resolve();
    });
  });
}

function releaseKdfSlot(): void {
  activeKdfCount = Math.max(0, activeKdfCount - 1);
  const next = waitQueue.shift();
  if (next) {
    next();
  }
}

export async function deriveScryptAsync(
  secret: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 },
): Promise<Buffer> {
  await acquireKdfSlot();
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(secret, salt, keylen, options, (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      });
    });
  } finally {
    releaseKdfSlot();
  }
}
