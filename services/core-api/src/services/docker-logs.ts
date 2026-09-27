// Docker returns logs of a container without a TTY as a multiplexed stream:
// each chunk is an 8-byte header (stream type, 3 zero bytes, big-endian
// uint32 length) followed by that many bytes. With a TTY it's raw text.
export function demuxDockerLogs(buf: Buffer): string {
  if (!looksMultiplexed(buf)) return buf.toString('utf8');
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    const start = offset + 8;
    parts.push(buf.subarray(start, Math.min(start + size, buf.length)));
    offset = start + size;
  }
  return Buffer.concat(parts).toString('utf8');
}

function looksMultiplexed(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
}

// Logs are shown in the browser and can end up in screenshots, so anything
// that looks like a credential is masked before it leaves core-api.
const REDACTIONS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,;"']+/gi, '$1$2[redacted]'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '[redacted-key]'],
  [/((?:password|passwd|pwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,;"'&}]+/gi, '$1[redacted]'],
];

export function redactSecrets(text: string): string {
  return REDACTIONS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
