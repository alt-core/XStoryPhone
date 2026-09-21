import { demoProjectConstantsGenerated as constants } from "../client/generated/demoProjectConstants.generated.ts";
import { clientStorageSettings } from "../client/system/clientStorage.ts";
import { resourceUrl } from "../client/system/resourceUrls.ts";
import { createStaticPlayerExecution } from "./playerExecution.ts";
import type { LocalPlayerExecution } from "../client/system/playerExecution.ts";

export const localPlayerExecution: LocalPlayerExecution = createStaticPlayerExecution({
  projectId: String(constants["project.id"]), clientRevision: String(constants["client.runtime_revision"]),
  entryUrl: new URL(resourceUrl("/static-entry.json"), location.href).href,
  storage: clientStorageSettings,
  resetForTesting: import.meta.env.DEV || import.meta.env.VITE_XSTORYPHONE_RESET_FOR_TESTING === "true"
});
