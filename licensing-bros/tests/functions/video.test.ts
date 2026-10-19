// Lesson video link parsing.
import { strict as assert } from "node:assert";
import { parseVideoUrl } from "../../supabase/functions/_shared/logic.ts";

const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

Deno.test("YouTube links become privacy-enhanced embeds", () => {
  for (const u of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
    "  https://youtu.be/dQw4w9WgXcQ  "
  ]) {
    assert.deepEqual(parseVideoUrl(u), { type: "youtube", url: YT }, u);
  }
});

Deno.test("YouTube start times carry over", () => {
  assert.deepEqual(parseVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=90"), { type: "youtube", url: `${YT}?start=90` });
  assert.deepEqual(parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s"), { type: "youtube", url: `${YT}?start=90` });
});

Deno.test("Bad YouTube ids are rejected", () => {
  assert.equal(parseVideoUrl("https://www.youtube.com/watch?v=short"), null);
  assert.equal(parseVideoUrl("https://www.youtube.com/watch"), null);
  assert.equal(parseVideoUrl("https://youtu.be/"), null);
});

Deno.test("Vimeo links become player embeds", () => {
  assert.deepEqual(parseVideoUrl("https://vimeo.com/76979871"), { type: "vimeo", url: "https://player.vimeo.com/video/76979871" });
  assert.deepEqual(parseVideoUrl("https://player.vimeo.com/video/76979871?autoplay=1"), { type: "vimeo", url: "https://player.vimeo.com/video/76979871" });
  assert.deepEqual(parseVideoUrl("https://vimeo.com/channels/staffpicks/76979871"), { type: "vimeo", url: "https://player.vimeo.com/video/76979871" });
  assert.deepEqual(parseVideoUrl("https://vimeo.com/76979871/a1b2c3d4e5"), { type: "vimeo", url: "https://player.vimeo.com/video/76979871?h=a1b2c3d4e5" }, "unlisted hash");
  assert.deepEqual(parseVideoUrl("https://player.vimeo.com/video/76979871?h=ff00aa11"), { type: "vimeo", url: "https://player.vimeo.com/video/76979871?h=ff00aa11" });
  assert.equal(parseVideoUrl("https://vimeo.com/about"), null);
});

Deno.test("storage: paths and direct files", () => {
  assert.deepEqual(parseVideoUrl("storage:videos/lesson-1.mp4"), { type: "storage", path: "videos/lesson-1.mp4" });
  assert.deepEqual(parseVideoUrl("storage:/videos/lesson 1.mp4"), { type: "storage", path: "videos/lesson 1.mp4" });
  assert.equal(parseVideoUrl("storage:"), null);
  assert.deepEqual(parseVideoUrl("https://cdn.example.com/v/lesson.mp4"), { type: "file", url: "https://cdn.example.com/v/lesson.mp4" });
});

Deno.test("empty and unsafe values give no video", () => {
  assert.equal(parseVideoUrl(null), null);
  assert.equal(parseVideoUrl(""), null);
  assert.equal(parseVideoUrl("javascript:alert(1)"), null);
  assert.equal(parseVideoUrl("ftp://example.com/x.mp4"), null);
});
