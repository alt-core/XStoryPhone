import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { loadAndValidateScenario } from "./scenario-lib.mjs";
import { buildStaticScenario } from "./lib/static-scenario.mjs";

export function staticExecutionAssets(): Plugin {
  let root = "";
  let outputDir = "";
  return {
    name: "xstoryphone-static-execution",
    configResolved(config) { root = config.root; outputDir = path.resolve(root, config.build.outDir); },
    async configureServer(server) {
      const directory = path.join(server.config.root, ".wrangler/static-execution");
      fs.mkdirSync(directory, { recursive: true });
      await buildStaticScenario({ root: server.config.root, outputDir: directory, scenario: loadAndValidateScenario() });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const base = server.config.base;
        const relative = pathname.startsWith(base) ? pathname.slice(base.length) : "";
        if (relative !== "static-entry.json" && !relative.startsWith("scenario/") && !relative.startsWith("static-audio-")) return next();
        const file = path.resolve(directory, relative);
        if (!file.startsWith(directory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.statusCode = 404; response.end(); return; }
        response.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".wav") ? "audio/wav" : "application/json");
        response.setHeader("Cache-Control", "no-store");
        fs.createReadStream(file).pipe(response);
      });
    },
    async closeBundle() {
      if (outputDir) await buildStaticScenario({ root, outputDir, scenario: loadAndValidateScenario() });
    }
  };
}
