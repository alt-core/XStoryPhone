import {
  Album,
  CalendarDays,
  MessageCircle,
  MessageSquareText,
  NotebookPen,
  Phone,
  Radio
} from "@lucide/svelte";
import type { Component } from "svelte";
import { demoDeviceStateGenerated } from "../generated/demoDeviceState.generated";
import type { AppCatalogEntry, AppId } from "../scenario-runtime/types";

const iconByKey: Record<string, Component> = {
  album: Album,
  calendar_days: CalendarDays,
  message_circle: MessageCircle,
  message_square_text: MessageSquareText,
  notebook_pen: NotebookPen,
  phone: Phone,
  radio: Radio
};

export type AppCatalogItem = Omit<AppCatalogEntry, "icon"> & {
  iconKey: string;
  icon: Component;
};

export function createAppCatalog(entries: readonly AppCatalogEntry[] = []): AppCatalogItem[] {
  return entries.map((entry) => ({
    ...entry,
    iconKey: entry.icon,
    icon: iconByKey[entry.icon] ?? Phone
  }));
}

export const appCatalog: AppCatalogItem[] = createAppCatalog(demoDeviceStateGenerated.apps);

export function getAppById(appId: AppId) {
  return appCatalog.find((app) => app.id === appId);
}
