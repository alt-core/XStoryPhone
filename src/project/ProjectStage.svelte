<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PhonePresentation, ProjectStageContext } from "./projectStage";

  export let context: ProjectStageContext;
  export let phone: Snippet<[PhonePresentation]>;

  const focusedPhone: PhonePresentation = { mode: "focused" };
</script>

<section
  class="project-stage"
  data-project-stage
  data-session-ready={context.sessionToken ? "true" : "false"}
>
  <div class="phone-stage-layer">
    {@render phone(focusedPhone)}
  </div>
</section>

<style>
  .project-stage {
    position: relative;
    display: grid;
    width: 100%;
    min-height: 100dvh;
  }

  .phone-stage-layer {
    position: absolute;
    inset: 0;
  }
</style>
