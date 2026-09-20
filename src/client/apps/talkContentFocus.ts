type FocusableTalk = {
  id: string;
  contentId?: string;
  corrupted?: boolean;
  messages: readonly { attachment?: { contentId?: string } | null }[];
};

export function talkForFocusedContent<T extends FocusableTalk>(threads: readonly T[], contentId: string): T | undefined {
  return threads.find((thread) => thread.id === contentId || thread.contentId === contentId)
    ?? threads.find((thread) => !thread.corrupted && thread.messages.some((message) => message.attachment?.contentId === contentId));
}
