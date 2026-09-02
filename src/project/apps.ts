import { defineProjectApps } from "../shared/projectApps.ts";

// 派生作品はこの配列へ1エントリ追加し、規約pathへApp.svelteを置く。
// case_filesはregistry境界を検証する非表示の例で、demo scenarioには追加していない。
export const projectApps = defineProjectApps([
  {
    id: "case_files",
    icon: "FolderSearch",
    validateRecord(record, report) {
      if (typeof record.title !== "string" || !record.title.trim()) report("record.title は空でない文字列にしてください。");
      if (typeof record.body !== "string") report("record.body は文字列にしてください。");
    },
    publicRecord(record) {
      return { title: String(record.title ?? ""), body: String(record.body ?? "") };
    },
    searchTitle(record) {
      return String(record.title ?? "");
    }
  }
]);
