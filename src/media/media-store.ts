import type { AttachmentKind } from "../domain/messages.js";

export interface MediaStore {
  /** Stores bytes privately and returns a short-lived HTTPS URL reachable by amoCRM. */
  put(input: { data: Buffer; kind: AttachmentKind; mimeType?: string; fileName?: string; sourceId: string }): Promise<{ url: string; size: number }>;
}
