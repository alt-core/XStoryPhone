import { mount } from "svelte";
import App from "./App.svelte";
import { demoProjectConstantsGenerated as projectConstants } from "./generated/demoProjectConstants.generated.ts";
import { trackClientError } from "./system/analytics";
import {
  initializeBrowserPlayerStorage,
  isBrowserPlayerStorageError
} from "./system/browserPlayerStorage.ts";
import { playerMode } from "./system/playerApi.ts";
import "./styles/global.css";
import "./styles/out-of-game.css";

function renderLoading(targetElement: HTMLElement) {
  targetElement.innerHTML = `
    <div class="out-game-root">
      <div class="out-game-dialog out-game-dialog--hold">
        <section class="start-confirmation-screen start-confirmation-screen--hold" aria-live="polite">
          <div class="hold-message"><p>プレイデータを読み込んでいます……</p></div>
        </section>
      </div>
    </div>
  `;
}

function renderGlobalError(targetElement: HTMLElement, supportCode = "AP-CLIENT") {
  targetElement.innerHTML = `
    <div class="out-game-root">
      <div class="out-game-dialog out-game-dialog--error">
        <section class="out-game-error-screen" role="alert" aria-labelledby="global-error-title">
          <div class="out-game-error-panel">
            <div class="out-game-error-mark" aria-hidden="true">!</div>
            <p class="out-game-kicker">ゲーム外のエラー</p>
            <h1 id="global-error-title">画面の表示に失敗しました</h1>
            <p>しばらくしてから、ページのリロードをお試しください。</p>
            <p class="out-game-support-code">エラーコード: ${supportCode}</p>
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

async function start(targetElement: HTMLElement) {
  renderLoading(targetElement);
  try {
    await initializeBrowserPlayerStorage({
      enabled: playerMode === "browser",
      projectId: String(projectConstants["project.id"] ?? ""),
      clientRevision: String(projectConstants["client.runtime_revision"] ?? "")
    });
    targetElement.replaceChildren();
    mount(App, { target: targetElement });
  } catch (error) {
    trackClientError({ kind: isBrowserPlayerStorageError(error) ? "storage_error" : "mount_error", reason: error });
    console.error("XStoryPhone の初期化に失敗しました。", error);
    renderGlobalError(targetElement, isBrowserPlayerStorageError(error) ? "AP-STORAGE" : "AP-CLIENT");
  }
}

const target = document.getElementById("app");
if (target) {
  void start(target);
} else {
  const fallbackTarget = document.createElement("div");
  fallbackTarget.id = "app";
  document.body.appendChild(fallbackTarget);
  void start(fallbackTarget);
}
