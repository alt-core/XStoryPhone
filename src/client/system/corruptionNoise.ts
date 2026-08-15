const corruptionNoiseUrls = [
  "/system/album-corruption-noise-01.webp",
  "/system/album-corruption-noise-02.webp",
  "/system/album-corruption-noise-03.webp",
  "/system/album-corruption-noise-04.webp",
  "/system/album-corruption-noise-05.webp",
  "/system/album-corruption-noise-06.webp",
  "/system/album-corruption-noise-07.webp",
  "/system/album-corruption-noise-08.webp",
  "/system/album-corruption-noise-09.webp",
  "/system/album-corruption-noise-10.webp"
];

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function corruptionNoiseUrl(sourceId: string) {
  const stableId = sourceId.trim() || "unknown";
  return corruptionNoiseUrls[hashString(stableId) % corruptionNoiseUrls.length];
}

export function corruptionNoiseStyle(sourceId: string) {
  return `--corruption-noise: url("${corruptionNoiseUrl(sourceId)}");`;
}
