import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAndValidateScenario } from "./scenario-lib.mjs";

// 新規player作成transactionの100操作から、accessとplayerの2操作を除いた上限。
export const AWS_INITIAL_SCHEDULE_LIMIT = 98;
export const AWS_INITIAL_SCHEDULE_ITEM_LIMIT_BYTES = 300 * 1_024;
export const AWS_INITIAL_SCHEDULE_TOTAL_LIMIT_BYTES = 3 * 1_024 * 1_024;

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertAwsInitialScheduleLimit(initialSchedules, playerMode = "server") {
  if (playerMode === "browser") return;
  if (initialSchedules.length > AWS_INITIAL_SCHEDULE_LIMIT) {
    throw new Error(
      `AWS版のinitialSchedulesは${AWS_INITIAL_SCHEDULE_LIMIT}件以下にしてください（現在${initialSchedules.length}件）。`
    );
  }
  const sizes = initialSchedules.map(jsonBytes);
  const oversizedIndex = sizes.findIndex((size) => size > AWS_INITIAL_SCHEDULE_ITEM_LIMIT_BYTES);
  if (oversizedIndex >= 0) {
    throw new Error(`AWS版のinitialSchedules[${oversizedIndex}]が大きすぎます（${sizes[oversizedIndex]} bytes）。`);
  }
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  if (totalBytes > AWS_INITIAL_SCHEDULE_TOTAL_LIMIT_BYTES) {
    throw new Error(`AWS版のinitialSchedules全体が大きすぎます（${totalBytes} bytes）。`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const scenario = loadAndValidateScenario();
    assertAwsInitialScheduleLimit(scenario.worker.initialSchedules, scenario.worker.playerMode);
    console.log(`AWSシナリオ監査OK: playerMode=${scenario.worker.playerMode}, initialSchedules=${scenario.worker.initialSchedules.length}`);
  } catch (error) {
    console.error("AWSシナリオ監査に失敗しました。");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
