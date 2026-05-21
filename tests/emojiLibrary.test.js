import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, getEmojiCategory } from "../src/emojiLibrary.js";

describe("emoji library", () => {
  it("groups stickers into phone-like categories", () => {
    expect(EMOJI_CATEGORIES.map((category) => category.id)).toEqual([
      "favorites",
      "nature",
      "animals",
      "food",
      "people",
      "body",
      "clothes",
      "places",
      "objects",
      "symbols",
    ]);
  });

  it("includes required face parts and clothing emojis", () => {
    const body = getEmojiCategory("body").items;
    const clothes = getEmojiCategory("clothes").items;

    expect(body).toEqual(expect.arrayContaining(["👀", "👁️", "👃", "👄", "🫦"]));
    expect(clothes).toEqual(expect.arrayContaining(["👕", "👗", "👔", "👖", "🧥", "👟", "👠", "👑", "👓"]));
  });

  it("keeps each category large enough for browsing", () => {
    expect(EMOJI_CATEGORIES.every((category) => category.items.length >= 20)).toBe(true);
  });
});
