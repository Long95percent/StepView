import { describe, expect, it } from "vitest";
import { createEmojiPatternStickers, createEmojiRainDrops, EMOJI_PATTERNS, EMOJI_RAIN_THEMES, getEmojiPattern, getEmojiRainLifetime } from "../src/emojiPlay.js";

describe("emoji play", () => {
  it("creates temporary emoji rain drops without board data", () => {
    const drops = createEmojiRainDrops(EMOJI_RAIN_THEMES[0], { width: 1000, height: 700 }, 12);

    expect(drops).toHaveLength(12);
    expect(drops.every((drop) => drop.emoji && drop.left >= 0 && drop.left <= 1000)).toBe(true);
    expect(drops.every((drop) => drop.top <= 0 && drop.fallDistance >= 700)).toBe(true);
    expect(getEmojiRainLifetime(drops)).toBeGreaterThan(Math.max(...drops.map((drop) => drop.delay + drop.duration)));
  });

  it("creates an emoji pattern as explicit sticker positions", () => {
    const pattern = EMOJI_PATTERNS.find((item) => item.id === "heart");
    const stickers = createEmojiPatternStickers(pattern, { x: 500, y: 300 });

    expect(stickers.length).toBeGreaterThan(10);
    expect(stickers[0]).toEqual(expect.objectContaining({ emoji: "💗" }));
    expect(stickers.every((sticker) => typeof sticker.x === "number" && typeof sticker.y === "number")).toBe(true);
  });

  it("offers multiple playful pattern templates", () => {
    expect(EMOJI_PATTERNS.map((pattern) => pattern.id)).toEqual(expect.arrayContaining([
      "heart",
      "flower-wreath",
      "constellation",
      "tiny-house",
      "cat-face",
    ]));
  });

  it("finds a pattern by id for drag-and-drop placement", () => {
    expect(getEmojiPattern("cat-face")).toMatchObject({ id: "cat-face", label: "猫猫脸" });
    expect(getEmojiPattern("missing-pattern")).toBe(EMOJI_PATTERNS[0]);
  });
});
