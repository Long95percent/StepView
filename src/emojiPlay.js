import { createEmojiSticker } from "./progressCore";

export const EMOJI_RAIN_THEMES = [
  { id: "sparkle", label: "星星雨", icon: "✨", emojis: ["✨", "🌟", "💫", "⭐", "⚡"] },
  { id: "flower", label: "花雨", icon: "🌸", emojis: ["🌸", "🌼", "🌷", "🌹", "🍃"] },
  { id: "heart", label: "爱心雨", icon: "💗", emojis: ["💗", "💖", "💕", "💜", "❤️"] },
  { id: "food", label: "食物雨", icon: "🍔", emojis: ["🍔", "🍕", "🍰", "🍓", "☕"] },
];

export const EMOJI_PATTERNS = [
  {
    id: "heart",
    label: "爱心",
    icon: "💗",
    cell: 34,
    rows: [
      ".11.11.",
      "1111111",
      "1111111",
      ".11111.",
      "..111..",
      "...1...",
    ],
    palette: { 1: "💗" },
  },
  {
    id: "flower-wreath",
    label: "花环",
    icon: "🌸",
    cell: 36,
    rows: [
      "..121..",
      ".1...1.",
      "2.....2",
      "1.....1",
      "2.....2",
      ".1...1.",
      "..121..",
    ],
    palette: { 1: "🌸", 2: "🌿" },
  },
  {
    id: "constellation",
    label: "星座",
    icon: "🌌",
    cell: 42,
    rows: [
      "1...2..",
      "..1....",
      "....2..",
      ".2...1.",
      "...1...",
    ],
    palette: { 1: "🌟", 2: "💫" },
  },
  {
    id: "tiny-house",
    label: "小房子",
    icon: "🏠",
    cell: 38,
    rows: [
      "..1..",
      ".111.",
      "22222",
      "2.3.2",
      "22222",
      "4...4",
    ],
    palette: { 1: "🏠", 2: "🧱", 3: "🚪", 4: "🌳" },
  },
  {
    id: "cat-face",
    label: "猫猫脸",
    icon: "🐱",
    cell: 36,
    rows: [
      "1...1",
      ".222.",
      "2.3.2",
      "2.4.2",
      ".222.",
    ],
    palette: { 1: "🐾", 2: "🐱", 3: "👀", 4: "👄" },
  },
];

export function createEmojiRainDrops(theme, viewportSize, count = 28) {
  const emojis = theme?.emojis?.length ? theme.emojis : EMOJI_RAIN_THEMES[0].emojis;
  const width = viewportSize?.width || 1200;
  const height = viewportSize?.height || 800;
  return Array.from({ length: count }, (_, index) => ({
    id: `emoji-rain-${Date.now()}-${index}`,
    emoji: emojis[index % emojis.length],
    left: Math.round((index / Math.max(1, count - 1)) * width),
    top: -40 - (index % 6) * 28,
    fallDistance: height + 120 + (index % 5) * 36,
    delay: (index % 10) * 70,
    duration: 1300 + (index % 6) * 140,
    size: 24 + (index % 5) * 6,
  }));
}

export function getEmojiRainLifetime(drops) {
  const longestDrop = Math.max(0, ...drops.map((drop) => drop.delay + drop.duration));
  return longestDrop + 400;
}

export function getEmojiPattern(patternId) {
  return EMOJI_PATTERNS.find((pattern) => pattern.id === patternId) || EMOJI_PATTERNS[0];
}

export function createEmojiPatternStickers(pattern, center) {
  const selectedPattern = pattern || EMOJI_PATTERNS[0];
  const rows = selectedPattern.rows || [];
  const cell = selectedPattern.cell || 36;
  const width = Math.max(...rows.map((row) => row.length), 0) * cell;
  const height = rows.length * cell;
  const originX = center.x - width / 2 + cell / 2;
  const originY = center.y - height / 2 + cell / 2;

  return rows.flatMap((row, rowIndex) =>
    [...row].flatMap((token, columnIndex) => {
      const item = selectedPattern.palette?.[token];
      if (!item) return [];
      return [createEmojiSticker(item, { x: originX + columnIndex * cell, y: originY + rowIndex * cell })];
    }),
  );
}
