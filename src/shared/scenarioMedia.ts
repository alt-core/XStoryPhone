import type { ScenarioAttachmentDefinition } from "./scenario.ts";

const mediaFields = ["image", "audio", "video"] as const;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export const usesStandardMedia = (appId: string) => ["photos", "phone", "radio"].includes(appId);

// 標準媒体の明示fieldだけ扱う。作品固有recordやHTML内のURLは探索しない。
export function mediaAttachmentIds(record: Record<string, unknown>): string[] {
  return [
    ...mediaFields.flatMap(kind => typeof record[`${kind}AttachmentId`] === "string" ? [record[`${kind}AttachmentId`] as string] : []),
    ...(Array.isArray(record.audioSegments) ? record.audioSegments.flatMap(segment => object(segment) && typeof segment.audioAttachmentId === "string" ? [segment.audioAttachmentId] : []) : [])
  ];
}

export function resolveMediaRecord(record: Record<string, unknown>, attachments: readonly ScenarioAttachmentDefinition[], required = true): Record<string, unknown> {
  const result = { ...record };
  for (const kind of mediaFields) {
    const key = `${kind}AttachmentId`;
    const id = record[key];
    if (typeof id !== "string") continue;
    const attachment = attachments.find(item => item.id === id && !item.unavailable && item.type === kind);
    if (!attachment?.asset && required) throw new Error(`素材のpartが未取得、または素材定義が不正です: ${id}`);
    delete result[key];
    result[`${kind}Url`] = attachment?.asset ?? "";
  }
  if (Array.isArray(record.audioSegments)) result.audioSegments = record.audioSegments.map(segment => object(segment) && segment.kind === "audio"
    ? resolveMediaRecord(segment, attachments, required) : segment);
  return result;
}
