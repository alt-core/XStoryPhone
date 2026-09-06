import { mount } from "svelte";
import App from "./App.svelte";
import { demoProjectConstantsGenerated as projectConstants } from "./generated/demoProjectConstants.generated.ts";
import { trackClientError } from "./system/analytics";
import {
  initializeBrowserPlayerStorage,
  deleteBrowserPlayerDatabase,
  isBrowserPlayerStorageError
} from "./system/browserPlayerStorage.ts";
import { playerMode } from "./system/playerApi.ts";
import { clearStartConfirmation, defaultUiState, saveUiState } from "./system/progress.ts";
import "./styles/global.css";
import "./styles/out-of-game.css";

const projectId = String(projectConstants["project.id"] ?? "");
const resetForTestingEnabled = import.meta.env.DEV || import.meta.env.VITE_XSTORYPHONE_RESET_FOR_TESTING === "true";

async function deleteBrowserProgressForRestart() {
  if (!resetForTestingEnabled && !window.confirm("このブラウザーの保存データを削除して最初から始めます。この操作は取り消せません。よろしいですか？")) {
    return false;
  }
  await deleteBrowserPlayerDatabase(projectId);
  clearStartConfirmation();
  saveUiState({ ...defaultUiState });
  window.location.replace("/");
  return true;
}

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

function renderGlobalError(targetElement: HTMLElement, supportCode = "AP-CLIENT", canRestart = false, deletionFailed = false) {
  targetElement.innerHTML = `
    <div class="out-game-root">
      <div class="out-game-dialog out-game-dialog--error">
        <section class="out-game-error-screen" role="alert" aria-labelledby="global-error-title">
          <div class="out-game-error-panel">
            <div class="out-game-error-mark" aria-hidden="true">!</div>
            <p class="out-game-kicker">ゲーム外のエラー</p>
            <h1 id="global-error-title">画面の表示に失敗しました</h1>
            <p>${deletionFailed
              ? "保存データの削除が完了したか確認できません。同じ作品を開いている他の画面を閉じてから、リロードしてください。"
              : "しばらくしてから、ページのリロードをお試しください。"}</p>
            <p class="out-game-support-code">エラーコード: ${supportCode}</p>
            <div class="out-game-error-actions">
              <button class="out-game-primary-button" type="button" data-reload-button>リロード</button>
              ${canRestart ? '<button class="out-game-primary-button" type="button" data-restart-button>保存データを削除して最初から始める</button>' : ""}
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  targetElement.querySelector("[data-reload-button]")?.addEventListener("click", () => {
    window.location.reload();
  });
  targetElement.querySelector<HTMLButtonElement>("[data-restart-button]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await deleteBrowserProgressForRestart();
    } catch (error) {
      trackClientError({ kind: "storage_error", reason: error });
      renderGlobalError(targetElement, "AP-STORAGE", false, true);
    } finally {
      button.disabled = false;
    }
  });
}

async function start(targetElement: HTMLElement) {
  renderLoading(targetElement);
  let deletingBrowserProgress = false;
  try {
    if (playerMode === "browser" && window.location.pathname.replace(/\/+$/, "").endsWith("/logout")) {
      deletingBrowserProgress = true;
      if (await deleteBrowserProgressForRestart()) return;
      deletingBrowserProgress = false;
      window.history.replaceState(window.history.state, "", "/");
    }
    await initializeBrowserPlayerStorage({
      enabled: playerMode === "browser",
      projectId,
      clientRevision: String(projectConstants["client.runtime_revision"] ?? "")
    });
    targetElement.replaceChildren();
    mount(App, { target: targetElement });
  } catch (error) {
    trackClientError({ kind: isBrowserPlayerStorageError(error) ? "storage_error" : "mount_error", reason: error });
    console.error("XStoryPhone の初期化に失敗しました。", error);
    renderGlobalError(
      targetElement,
      isBrowserPlayerStorageError(error) ? "AP-STORAGE" : "AP-CLIENT",
      playerMode === "browser" && isBrowserPlayerStorageError(error) && error.kind === "corrupt",
      deletingBrowserProgress
    );
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
