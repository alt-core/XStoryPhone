import type { ProjectStageContext } from "../../project/projectStage";

export type ProjectAppContent = Record<string, unknown> & {
  id: string;
  contentId: string;
  initialState?: "normal" | "repairable" | "hidden";
  corrupted?: boolean;
  repairLabel?: string;
};

export type ProjectAppProps = {
  items: readonly ProjectAppContent[];
  context: ProjectStageContext;
  focusContentId: string;
  focusContentRequestId: number;
  onContentOpen(contentId: string): void;
  onBlockedContentOpen(contentId: string): void;
  onNoise(): void;
};
