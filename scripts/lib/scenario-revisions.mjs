import { createHash } from "node:crypto";

function revisionHash(namespace, value) {
  return `${namespace}_${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16)}`;
}

export function clientRevisionFor({ packageVersion, projectConstants, deviceState, publicIds, source }) {
  return revisionHash("client", { packageVersion, projectConstants, deviceState, publicIds, source });
}

export function transcriptRevisionFor({ version, talks, talkPeople, talkBlocks, attachments, publicIds, runtime }) {
  return revisionHash("transcript", { version, talks, talkPeople, talkBlocks, attachments, publicIds, runtime });
}
