import { demoProjectConstantsGenerated as projectConstants } from "../generated/demoProjectConstants.generated.ts";
import { prefixStorageKey, resolveClientStorageSettings } from "../../shared/clientStorage.ts";

// ページ中は固定。保存先を切り替えたり、既存の保存を探索したりしない。
export const clientStorageSettings = resolveClientStorageSettings(
  String(projectConstants["player.mode"] ?? "server"),
  {
    VITE_XSTORYPHONE_CLIENT_STORAGE: import.meta.env?.VITE_XSTORYPHONE_CLIENT_STORAGE,
    VITE_XSTORYPHONE_STORAGE_PREFIX: import.meta.env?.VITE_XSTORYPHONE_STORAGE_PREFIX
  }
);
export const isMemoryStorage = clientStorageSettings.mode === "memory";
export const clientStorageKey = (key: string) => prefixStorageKey(key, clientStorageSettings.prefix);
