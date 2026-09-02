export type ProjectAppDefinition = {
  id: string;
  icon: string;
  validateRecord(record: Record<string, unknown>, report: (message: string) => void): void;
  publicRecord(record: Record<string, unknown>): Record<string, unknown>;
  searchTitle?(record: Record<string, unknown>): string;
};

export function defineProjectApps<const Definitions extends readonly ProjectAppDefinition[]>(definitions: Definitions) {
  return definitions;
}
