import mime from "mime";

export function getMimeType(filename: string): string {
  return mime.getType(filename) ?? "application/octet-stream";
}
