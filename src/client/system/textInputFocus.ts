// マウスとキーボードで操作する端末か。タッチが主の端末では、入力欄へフォーカスするとソフトウェアキーボードが出る。
export function prefersKeyboardFocus() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

// 送信後、タッチが主の端末では入力欄から離れてキーボードを閉じ、届く返信を読めるようにする。
// それ以外ではフォーカスを保ち、そのまま次を打てるようにする。
export function releaseTextInputAfterSend(input: HTMLElement | null | undefined) {
  if (!prefersKeyboardFocus()) input?.blur();
}

// マウスで送信ボタンを押しても、フォーカスを入力欄から移さない。
export function keepTextInputFocus(event: MouseEvent) {
  event.preventDefault();
}
