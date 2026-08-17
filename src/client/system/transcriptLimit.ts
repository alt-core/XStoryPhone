export function limitedSearchMessages<T>(messages: readonly T[]) {
  return messages.length > 200 ? messages.slice(-200) : [...messages];
}
