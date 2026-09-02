// v4で独立search streamを固定search_agent talkへ統合したため、旧cacheを再利用しない。
export const transcriptCacheVersion = 4;

export function transcriptCacheCompatible(
  stored: {
    version?: unknown;
    credential?: unknown;
    clientRevision?: unknown;
    transcriptRevision?: unknown;
    transcripts?: unknown;
  },
  credential: string,
  transcriptRevision: string
) {
  if (stored.version !== transcriptCacheVersion || !stored.transcripts) return false;
  if (stored.credential !== credential) return false;
  if (stored.transcriptRevision !== transcriptRevision) return false;
  return true;
}
