import crypto from 'crypto';

function encryptPassword(v, k) {
  if (typeof v === 'string') v = Buffer.from(v, 'utf8');
  if (typeof k === 'string') k = Buffer.from(k, 'utf8');

  const iv = Buffer.from('xidianscriptsxdu', 'utf8');
  const prefix = Buffer.from('xidianscriptsxdu'.repeat(4), 'utf8');
  const data = Buffer.concat([prefix, v]);
  const paddedData = pkcs7Pad(data, 16);

  const cipher = crypto.createCipheriv('aes-128-cbc', k, iv);

  const encrypted = Buffer.concat([
    cipher.update(paddedData),
    //cipher.final()
  ]);

  return encrypted.toString('base64');
}

function pkcs7Pad(data, blockSize) {
  const padding = blockSize - (data.length % blockSize);
  const padBuffer = Buffer.alloc(padding, padding);
  return Buffer.concat([data, padBuffer]);
}

export { encryptPassword};
