import type { AppId } from "../scenario-runtime/types";

export type TalkDraft = {
  text: string;
  photoId: string;
  share: { appId: AppId; contentId: string; title: string } | null;
  error: string;
};

// componentごとに作り、同じルームでは同じ下書きを参照する。永続化はしない。
export function createTalkDrafts() {
  const drafts = new Map<string, TalkDraft>();
  return (talkId: string): TalkDraft => {
    let draft = drafts.get(talkId);
    if (!draft) {
      draft = { text: "", photoId: "", share: null, error: "" };
      drafts.set(talkId, draft);
    }
    return draft;
  };
}

export function restoreFailedTalkDraft(draft: TalkDraft, previous: TalkDraft, error?: string) {
  // 送信開始時に捕捉したルームへ戻す。同じルームの新しい入力も上書きしない。
  if (!draft.text && !draft.photoId && !draft.share) {
    draft.text = previous.text;
    draft.photoId = previous.photoId;
    draft.share = previous.share;
  }
  draft.error = error ?? "送信に失敗しました。";
}
