<script lang="ts">
  import { ChevronLeft, ChevronRight, Clock3, MapPin } from "@lucide/svelte";
  import { parseStoryDate, storyWeekFor } from "../../shared/storyDate";
  import type { CalendarEvent } from "../scenario-runtime/types";
  import ScrollHint from "../system/ScrollHint.svelte";
  import AppShell from "./AppShell.svelte";

  export let events: CalendarEvent[] = [];
  export let currentDate = "";
  export let focusContentId = "";
  export let focusContentRequestId = 0;
  export let onContentOpen: (contentId: string) => void = () => {};
  export let onNoise: (durationMs?: number) => void = () => {};

  let selectedDate = currentDate;
  let visibleWeekDate = currentDate;
  let lastAppliedCurrentDate = "";
  let lastReportedContentSignature = "";
  let lastAppliedFocusContentId = "";
  let lastAppliedFocusContentRequestId = focusContentRequestId;

  $: if (currentDate && currentDate !== lastAppliedCurrentDate) {
    lastAppliedCurrentDate = currentDate;
    selectedDate = currentDate;
    visibleWeekDate = currentDate;
  }
  $: if (!focusContentId) {
    lastAppliedFocusContentId = "";
    lastAppliedFocusContentRequestId = focusContentRequestId;
  } else if (focusContentId !== lastAppliedFocusContentId || focusContentRequestId !== lastAppliedFocusContentRequestId) {
    const focused = events.find((event) => event.contentId === focusContentId || event.id === focusContentId);
    if (focused) {
      lastAppliedFocusContentId = focusContentId;
      lastAppliedFocusContentRequestId = focusContentRequestId;
      selectedDate = focused.date;
      visibleWeekDate = focused.date;
    }
  }
  $: weekDays = storyWeekFor(visibleWeekDate);
  $: selectedEvents = events.filter((event) => event.date === selectedDate);
  $: selectedDayIndex = weekDays.findIndex((item) => item.value === selectedDate);
  $: selectedDay = weekDays.find((item) => item.value === selectedDate) ?? weekDays[0];
  $: selectedDateParts = parseStoryDate(selectedDate);
  $: selectedMonthLabel = selectedDateParts ? `${selectedDateParts.year}年${selectedDateParts.month}月` : "";
  $: selectedEventContentIds = selectedEvents
    .filter((event) => !event.corrupted)
    .map((event) => event.contentId ?? event.id)
    .filter(Boolean);
  $: selectedEventContentSignature = selectedEventContentIds.join("\n");
  $: if (selectedEventContentSignature && selectedEventContentSignature !== lastReportedContentSignature) {
    lastReportedContentSignature = selectedEventContentSignature;
    selectedEventContentIds.forEach((contentId) => onContentOpen(contentId));
  }

  function moveSelectedDate(direction: -1 | 1) {
    const currentIndex = selectedDayIndex >= 0 ? selectedDayIndex : 0;
    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= weekDays.length) {
      onNoise(260);
      return;
    }

    selectedDate = weekDays[nextIndex].value;
  }
</script>

<AppShell title="スケジュール" subtitle={selectedMonthLabel} accent="#f07178">
  <div class="calendar-layout">
    <div class="month-strip" aria-label="週間カレンダー">
      {#each weekDays as item}
        <button
          type="button"
          class:today={item.value === currentDate}
          class:selected={item.value === selectedDate}
          aria-current={item.value === selectedDate ? "date" : undefined}
          on:click={() => (selectedDate = item.value)}
        >
          <small>{item.weekdayLabel}</small>
          <strong>{item.day}</strong>
        </button>
      {/each}
    </div>

    <div class="day-navigator">
      <button class="day-shift prev" type="button" aria-label="前の日へ" title="前の日へ" on:click={() => moveSelectedDate(-1)}>
        <ChevronLeft size={15} strokeWidth={2.35} />
      </button>
      <section class="today-card">
        <div class="selected-day">
          <span>{selectedDateParts?.year ?? "----"}年</span>
          <strong>{selectedDateParts?.month ?? "--"}月{selectedDay?.day ?? "--"}日</strong>
        </div>
        <div class="today-meta">
          <span>{selectedDate === currentDate ? "今日" : `${selectedDay?.weekdayLabel ?? "--"}曜日`}</span>
          <p>{selectedEvents.length}件の予定</p>
        </div>
      </section>
      <button class="day-shift next" type="button" aria-label="次の日へ" title="次の日へ" on:click={() => moveSelectedDate(1)}>
        <ChevronRight size={15} strokeWidth={2.35} />
      </button>
    </div>

    <ScrollHint enabled={selectedEvents.length > 2} step={108}>
      <div class="events" class:scrolling={selectedEvents.length > 2}>
        {#if selectedEvents.length}
          {#each selectedEvents as event}
            <article>
              <time>
                <Clock3 size={15} strokeWidth={2.1} />
                <strong>{event.time}</strong>
              </time>
              <div>
                <h3>{event.title}</h3>
                {#if event.place.trim()}
                  <p class="event-place"><MapPin size={14} strokeWidth={2} /> {event.place}</p>
                {/if}
                {#if event.memo.trim()}
                  <span>{event.memo}</span>
                {/if}
              </div>
            </article>
          {/each}
        {:else}
          <article>
            <time>
              <Clock3 size={15} strokeWidth={2.1} />
              <strong>--:--</strong>
            </time>
            <div>
              <h3>予定なし</h3>
              <span>登録された予定はありません。</span>
            </div>
          </article>
        {/if}
      </div>
    </ScrollHint>
  </div>
</AppShell>

<style>
  .calendar-layout {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 12px;
    box-sizing: border-box;
    min-height: 0;
    height: 100%;
    padding: 14px 14px 118px;
  }

  .calendar-layout :global(.scroll-hint-shell) {
    min-height: 0;
    height: 100%;
  }

  .month-strip {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
    padding: 5px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: rgba(255, 255, 255, 0.045);
  }

  .month-strip button {
    display: grid;
    place-items: center;
    gap: 3px;
    min-width: 0;
    height: 48px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    color: rgba(255, 255, 255, 0.6);
    cursor: pointer;
    font: inherit;
  }

  .month-strip button.today {
    border-color: rgba(240, 113, 120, 0.34);
    background: rgba(240, 113, 120, 0.12);
    color: #ffd8da;
  }

  .month-strip button.selected {
    border-color: rgba(240, 113, 120, 0.46);
    background: linear-gradient(180deg, rgba(240, 113, 120, 0.3), rgba(240, 113, 120, 0.14));
    color: #fff;
  }

  .month-strip small {
    font-size: 0.62rem;
    font-weight: 760;
  }

  .month-strip strong {
    font-size: 0.98rem;
    line-height: 1;
  }

  .day-navigator {
    position: relative;
    min-width: 0;
  }

  .day-shift {
    position: absolute;
    top: 50%;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid rgba(240, 113, 120, 0.28);
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 22%, rgba(255, 255, 255, 0.22), transparent 32%),
      linear-gradient(180deg, rgba(240, 113, 120, 0.22), rgba(255, 255, 255, 0.06)),
      rgba(8, 12, 18, 0.78);
    color: #ffe2e4;
    cursor: pointer;
    line-height: 0;
    box-shadow:
      0 8px 18px rgba(0, 0, 0, 0.28),
      var(--ap-shadow-inset);
    backdrop-filter: blur(14px);
    transform: translateY(-50%);
  }

  .day-shift.prev {
    left: 9px;
  }

  .day-shift.next {
    right: 9px;
  }

  .day-shift:active {
    transform: translateY(calc(-50% + 1px));
  }

  .day-shift :global(svg) {
    display: block;
  }

  .today-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
    padding: 14px 46px;
    border: 1px solid rgba(240, 113, 120, 0.16);
    border-radius: var(--ap-radius-panel);
    background:
      radial-gradient(circle at 14% 20%, rgba(240, 113, 120, 0.28), transparent 34%),
      rgba(255, 255, 255, 0.075);
  }

  .selected-day {
    display: grid;
    gap: 2px;
  }

  .today-card span,
  .today-card p {
    margin: 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.72rem;
    font-weight: 760;
  }

  .today-card strong {
    font-size: 1.25rem;
  }

  .today-meta {
    display: grid;
    justify-items: end;
    gap: 3px;
    text-align: right;
  }

  .today-meta span {
    color: #ffd2d4;
    font-size: 0.78rem;
    line-height: 1;
  }

  .events {
    display: grid;
    align-content: start;
    gap: 10px;
    min-height: 0;
    height: 100%;
    overflow: auto;
    overscroll-behavior: contain;
    padding-bottom: 12px;
    scrollbar-width: none;
  }

  .events.scrolling {
    mask-image: linear-gradient(180deg, #000 0, #000 calc(100% - 20px), rgba(0, 0, 0, 0.18));
  }

  .events.scrolling::-webkit-scrollbar {
    display: none;
  }

  article {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr);
    gap: 12px;
    padding: 13px;
    border: 1px solid var(--ap-border);
    border-radius: var(--ap-radius-panel);
    background: var(--ap-surface-1);
    box-shadow: var(--ap-shadow-inset);
  }

  time {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 4px;
    min-height: 80px;
    border-radius: var(--ap-radius-card);
    background:
      linear-gradient(180deg, rgba(240, 113, 120, 0.26), rgba(240, 113, 120, 0.13));
    color: #ffd2d4;
    text-align: center;
  }

  time strong {
    color: #fff;
    font-size: 0.92rem;
  }

  h3,
  p {
    margin: 0;
  }

  h3 {
    font-size: 1rem;
  }

  .event-place {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 7px;
    color: #ffc7ca;
    font-size: 0.76rem;
  }

  article div > span {
    display: block;
    margin-top: 8px;
    color: rgba(255, 255, 255, 0.66);
    font-size: 0.78rem;
    line-height: 1.55;
  }
</style>
