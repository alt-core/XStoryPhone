export const SEARCH_AGENT_TALK_ID = "search_agent";
export const SEARCH_AGENT_STREAM_ID = `talk:${SEARCH_AGENT_TALK_ID}`;
export const MAX_SEARCH_AGENT_DISPLAY_ITEMS = 200;
export const MAX_SEARCH_AGENT_QUERY_LENGTH = 500;
// /searchの結果から出力step内だけに提供する値。作者定義のstateとは分ける。
export const SEARCH_OUTPUT_STATE_DEFINITIONS = {
  search_found: { type: "boolean" },
  search_result_count: { type: "integer" }
} as const;
