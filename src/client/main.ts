import { mount } from "svelte";
import App from "./App.svelte";
import { trackClientError } from "./system/analytics";
import "./styles/global.css";
import "./styles/out-of-game.css";

const target = document.getElementById("app");

function renderGlobalError(targetElement: HTMLElement) {
  targetElement.innerHTML = `
    <div class="out-game-root">
      <div class="out-game-dialog out-game-dialog--error">
        <section class="out-game-error-screen" role="alert" aria-labelledby="global-error-title">
          <div class="out-game-error-panel">
            <div class="out-game-error-mark" aria-hidden="true">!</div>
            <p class="out-game-kicker">ゲーム外のエラー</p>
            <h1 id="global-error-title">画面の表示に失敗しました</h1>
            <p>しばらくしてから、ページのリロードをお試しください。</p>
            <p>解消しない場合は、この作品の運営者へパスコードを添えてお問い合わせください。</p>
            <div class="out-game-error-actions">
              <button class="out-game-primary-button" type="button" data-reload-button>リロード</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  targetElement.querySelector("[data-reload-button]")?.addEventListener("click", () => {
    window.location.reload();
  });
}

if (target) {
  try {
    mount(App, { target });
  } catch (error) {
    trackClientError({ kind: "mount_error", reason: error });
    console.error("XStoryPhone の初期化に失敗しました。", error);
    renderGlobalError(target);
  }
} else {
  const fallbackTarget = document.createElement("div");
  fallbackTarget.id = "app";
  document.body.appendChild(fallbackTarget);
  renderGlobalError(fallbackTarget);
}
