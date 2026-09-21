import type { PlayerRecord } from "./store.ts";

// staticもbrowserと同じ操作・予約・hook・commitを使い、署名tokenの受渡しだけを省く。
// 予約の確定とユーザー操作の確定を分け、後段の失敗でも確定済み進行を保つ。
export type LocalPlayerProgress = {
  read(): PlayerRecord | null;
  commit(player: PlayerRecord): Promise<void>;
};
