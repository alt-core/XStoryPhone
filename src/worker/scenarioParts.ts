import type { PartOwned, ScenarioContent, ScenarioTalkBlock, WorkerScenario } from "../shared/scenario.ts";
import { messageTemplateKeys } from "../shared/messageTemplateKeys.ts";

type PartCollectionKey = { [K in keyof WorkerScenario]-?: NonNullable<WorkerScenario[K]> extends readonly PartOwned[] ? K : never }[keyof WorkerScenario];
const partFields = {
  apps: true, contents: true, talks: true, talkBlocks: true, talkPeople: true, attachments: true,
  incomingCalls: true, generatedAudio: true, todos: true, notifications: true, assistantMessages: true,
  hooks: true, lockedContentPasswords: true
} satisfies Record<PartCollectionKey, true>;
export const partCollectionKeys = Object.keys(partFields) as Array<keyof typeof partFields>;

export function partOf(value: PartOwned) { return value.part ?? "base"; }

function initialBlockStub(block: ScenarioTalkBlock, catalog: WorkerScenario): ScenarioTalkBlock {
  if (block.unavailable) return block;
  return {
    id: block.id, talkId: block.talkId, blockKey: block.blockKey, part: partOf(block), order: block.order, acceptsInput:block.acceptsInput,
    unavailable: true,
    messages: block.messages.map(message => {
      return {
        id: message.id, sender: "", initialRole: catalog.talkPeople.find(person => person.id === message.sender)?.role === "owner" ? "owner" : "npc",
        body: "", initialTemplateKeys: messageTemplateKeys(message), attachmentId: "", sentAt: message.sentAt, notes: "", updatedAt: "", source: ""
      };
    })
  };
}

function contentStub(content: ScenarioContent): ScenarioContent {
  const history = (content.appId === "messages" || content.appId === "chat") && typeof content.record.block === "string";
  return {
    id: content.id, publicId: content.publicId, appId: content.appId, initialState: content.initialState,
    part: partOf(content), order: content.order, unavailable: true,
    repairLabel: content.repairLabel, cond: content.cond, search: [],
    record: history ? { talk: content.record.talk, block: content.record.block }
      : typeof content.record.attachment === "string" ? { attachment: content.record.attachment } : {}
  };
}

// 所属の絞込みを各判定へ散らさず、操作に渡す定義をここで揃える。
// 未取得の破損枠と初期履歴slotは維持するが、本文・検索語・素材URLは含めない。
export function scenarioForParts(catalog: WorkerScenario, partIds: readonly string[]): WorkerScenario {
  const loaded = new Set(["base", ...partIds]);
  const available = (value: PartOwned) => loaded.has(partOf(value)) && !value.unavailable;
  const passwords = catalog.lockedContentPasswords.filter(available);
  const lockTargets = new Set(passwords.map(password => password.contentId));
  const contents = catalog.contents.flatMap(content => available(content) ? [content]
    : content.initialState === "repairable" || lockTargets.has(content.id) ? [contentStub(content)] : []);
  const talks = catalog.talks.flatMap(talk => {
    if (!available(talk)) {
      return talk.kind !== "search_agent" && talk.initialState === "repairable" ? [{
        ...talk, unavailable: true, label: talk.repairLabel ?? "破損データ", avatarUrl: undefined,
        search: [], startBlocks: [], rules: []
      }] : [];
    }
    return [{ ...talk, rules: talk.rules.filter(available).map(rule => rule.contextPart && !loaded.has(rule.contextPart)
      ? { ...rule, criteria: "" } : rule) }];
  });
  const initialBlockIds = new Set(talks.flatMap(talk => talk.kind === "search_agent" ? [] : talk.startBlocks));
  const talkBlocks = catalog.talkBlocks.flatMap(block => available(block) ? [block]
    : initialBlockIds.has(block.id) ? [initialBlockStub(block, catalog)] : []);
  const attachments = catalog.attachments.flatMap(attachment => available(attachment) ? [attachment]
    : attachment.lock === "password" && attachment.content && lockTargets.has(attachment.content) ? [{
      id: attachment.id, type: attachment.type, content: attachment.content, lock: attachment.lock,
      title: attachment.title, part: partOf(attachment), order: attachment.order, unavailable: true
    }] : []);
  const stateIds = new Set(Object.keys(catalog.stateVariables).filter(id => loaded.has(catalog.stateVariableParts?.[id] ?? "base")));
  const selectRecord = <T>(record: Readonly<Record<string, T>>, ids: ReadonlySet<string>) => Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
  const result: WorkerScenario = {
    ...catalog, parts: [...loaded], contents, talks, talkBlocks, attachments,
    apps: catalog.apps.flatMap(app => available(app) ? [app] : app.initialState === "repairable" ? [{ ...app, label: app.repairLabel ?? "破損アプリ", search: [], unavailable: true }] : []),
    stateVariables: selectRecord(catalog.stateVariables, stateIds),
    stateVariableDefinitions: selectRecord(catalog.stateVariableDefinitions, stateIds),
    stateVariableParts: selectRecord(catalog.stateVariableParts ?? {}, stateIds),
    publicStateVariables: catalog.publicStateVariables.filter(id => stateIds.has(id)),
    photoDescriptions: selectRecord(catalog.photoDescriptions, new Set(contents.filter(available).map(content => content.id))),
    repeatTalkBlocks: selectRecord(catalog.repeatTalkBlocks, new Set(talkBlocks.filter(available).map(block => block.id))),
    albumMediaAttachmentLinks: catalog.albumMediaAttachmentLinks.filter(link => attachments.some(item => item.id === link.attachmentId) && contents.some(item => item.id === link.photoId))
  };
  const special = new Set<string>(["apps", "contents", "talks", "talkBlocks", "attachments"]);
  Object.assign(result, Object.fromEntries(partCollectionKeys.filter(key => !special.has(key)).map(key => [key, catalog[key].filter(available)])));
  const ids = {
    content: result.contents.map(item => item.id), talk: result.talks.map(item => item.id),
    attachment: result.attachments.map(item => item.id), incomingCall: result.incomingCalls.map(item => item.id),
    notification: result.notifications.map(item => item.id), generatedAudio: result.generatedAudio.map(item => item.id),
    form: result.contents.flatMap(item => {
      const form = item.record.form;
      return form && typeof form === "object" && "id" in form && typeof form.id === "string" ? [form.id] : [];
    }),
    scenarioEvent: [...result.clientCallableEvents, ...result.hooks.flatMap(hook => [hook.event, hook.target])]
  } satisfies Record<keyof WorkerScenario["publicIds"], string[]>;
  result.publicIds = Object.fromEntries(Object.entries(catalog.publicIds).map(([key, values]) => [key,
    selectRecord(values, new Set(ids[key as keyof typeof ids]))
  ])) as WorkerScenario["publicIds"];
  result.hookTalkBlocks = Object.fromEntries(result.talks.map(talk => [talk.id,
    (catalog.hookTalkBlocks?.[talk.id] ?? []).filter(key => result.talkBlocks.some(block => block.talkId === talk.id && block.blockKey === key && !block.unavailable))
  ]));
  return result;
}
