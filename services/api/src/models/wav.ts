import { ProviderResponseError } from "./errors";
/** Extract PCM samples only after checking RIFF boundaries and the required audio format. */
export function pcmFromWav(bytes: Uint8Array): Uint8Array {
  const data = Buffer.from(bytes);
  let pcm: Uint8Array | undefined;
  let formatValid = false;
  if (
    data.length < 12 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE" ||
    data.readUInt32LE(4) + 8 > data.length
  )
    throw new ProviderResponseError();
  const end = data.readUInt32LE(4) + 8;
  for (let offset = 12; offset + 8 <= end;) {
    const kind = data.toString("ascii", offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > end) throw new ProviderResponseError();
    if (kind === "fmt ") {
      if (length < 16) throw new ProviderResponseError();
      formatValid = validFormat(data, start);
    }
    if (kind === "data") pcm = data.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  if (!formatValid || pcm === undefined || pcm.length % 2 !== 0)
    throw new ProviderResponseError();
  return pcm;
}

function validFormat(data: Buffer, start: number): boolean {
  return (
    data.readUInt16LE(start) === 1 &&
    data.readUInt16LE(start + 2) === 1 &&
    data.readUInt32LE(start + 4) === 16000 &&
    data.readUInt32LE(start + 8) === 32000 &&
    data.readUInt16LE(start + 12) === 2 &&
    data.readUInt16LE(start + 14) === 16
  );
}
