import type { AppId } from "./appRegistry.ts";
import type { ScenarioMessageAttachment } from "./scenario.ts";

// hook と制作表で同じ上限を使う。改行を含む UTF-16 コード単位で数える。
export const MAX_GAME_OVER_REASON_LENGTH = 160;

export type PublicPresentationMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; appId: AppId; contentId: string; linkId?: string }
  | { kind: "link"; text: string; externalUrl: string };

export type PublicPresentationTalkMessage = {
  seq?: number;
  id: string;
  talkId: string;
  kind: "sms" | "chat";
  sender: "owner" | "other";
  senderName: string | null;
  body: string;
  avatarUrl?: string;
  segments?: PublicPresentationMessageSegment[];
  delayMs?: number;
  delayOnFirstDisplay?: boolean;
  historyRepairId?: string;
  attachment: ScenarioMessageAttachment | null;
  sentAt: string;
};

export type PublicPresentationEffect =
  | { type: "noise"; durationMs: number }
  | {
      type: "flash";
      fadeInMs: number;
      holdMs: number;
      fadeOutMs: number;
      intensity: number;
      color: string;
    }
  | {
      type: "blackout";
      fadeInMs: number;
      holdMs: number;
      fadeOutMs: number;
      intensity: number;
    };

export type PublicPresentationSequence =
  | {
      type: "game_over";
      reasonMessage?: string;
      talk?: {
        talkId: string;
        kind: "sms" | "chat";
        messages: PublicPresentationTalkMessage[];
      };
    }
  | {
      type: "all_clear";
      target: {
        appId: AppId;
        contentId: string;
      };
      autoplay: boolean;
    };

export type PublicPresentationPayload = {
  effects: PublicPresentationEffect[];
  sequence?: PublicPresentationSequence;
};

export type PublicPresentationResponse = {
  presentation?: PublicPresentationPayload;
};
