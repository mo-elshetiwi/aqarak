export interface ObjectLocation {
  readonly bucket: string;
  readonly key: string;
}
export interface BoundObject extends ObjectLocation {
  readonly versionId: string;
}
export interface UploadObject extends ObjectLocation {
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
}
export interface SignedUpload {
  readonly method: "PUT";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}
export interface DocumentStorage {
  readonly bucket: string;
  readonly keyPrefix: string;
  presignPut(input: UploadObject): Promise<SignedUpload>;
  head(input: ObjectLocation): Promise<{
    readonly byteSize: number;
    readonly checksum: string;
    readonly versionId: string;
  } | null>;
  scanStatus(input: BoundObject): Promise<string | null>;
  getBytes(input: BoundObject): Promise<Uint8Array>;
  putReceipt(input: ObjectLocation, receipt: unknown): Promise<void>;
  presignGet(
    input: BoundObject,
  ): Promise<{ readonly url: string; readonly expiresAt: string }>;
}
