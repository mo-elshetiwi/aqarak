/** In-memory native file fixtures keep capture tests independent of disk and media. */
export const captureTestFiles = new Map<string, number>();
const directories = new Set<string>();
function join(parts: (string | { uri: string })[]): string {
  return parts
    .map((part, index) => {
      const uri = typeof part === "string" ? part : part.uri;
      return index === 0 ? uri.replace(/\/$/, "") : uri.replace(/^\/|\/$/g, "");
    })
    .join("/");
}
/** Minimal directory behavior matches the private-storage boundary used by capture. */
export class Directory {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(parts);
  }
  get exists(): boolean {
    return directories.has(this.uri);
  }
  create(): void {
    directories.add(this.uri);
  }
  delete(): void {
    for (const uri of captureTestFiles.keys())
      if (uri.startsWith(`${this.uri}/`)) captureTestFiles.delete(uri);
    directories.delete(this.uri);
  }
}
/** Only native operations used by capture are represented, with observable copy and deletion. */
export class File {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(parts);
  }
  get exists(): boolean {
    return captureTestFiles.has(this.uri);
  }
  get size(): number {
    return captureTestFiles.get(this.uri) ?? 0;
  }
  copy(destination: { uri: string }): Promise<void> {
    if (!this.exists)
      return Promise.reject(new Error("Missing synthetic file"));
    captureTestFiles.set(destination.uri, this.size);
    return Promise.resolve();
  }
  delete(): void {
    captureTestFiles.delete(this.uri);
  }
}
/** Native cache location is deliberately synthetic. */
export const Paths = { cache: new Directory("file:///private-cache") };
/** Every test starts without files from a previous account or company. */
export function resetCaptureTestFiles(): void {
  captureTestFiles.clear();
  directories.clear();
}
