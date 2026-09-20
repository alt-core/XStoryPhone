import { loadAndValidateScenario } from "./authoring-fixture.mjs";
try {
  loadAndValidateScenario();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
