-- MCP lesson_memory stores category lesson. Dashboard can list/filter the same value.
alter table public.memories
  drop constraint memories_category_check;

alter table public.memories
  add constraint memories_category_check
    check (category in ('fact', 'decision', 'goal', 'deadline', 'preference', 'lesson'));
