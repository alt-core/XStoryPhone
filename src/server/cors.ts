import { normalizeHttpOrigin } from "../shared/deploymentUrls.ts";

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((origin, index) => (
    normalizeHttpOrigin(origin.trim(), `ALLOWED_ORIGINSの${index + 1}番目`)
  )))];
}
