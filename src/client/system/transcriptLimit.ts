import { MAX_SEARCH_AGENT_DISPLAY_ITEMS } from "../../shared/searchAgent.ts";

export function limitedSearchAgentItems<T>(items: readonly T[]) {
  return items.slice(-MAX_SEARCH_AGENT_DISPLAY_ITEMS);
}
