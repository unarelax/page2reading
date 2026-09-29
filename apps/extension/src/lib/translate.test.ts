import { describe, expect, it } from "vitest";
import { looksTranslated, packSectionGroups, parseNumberedBlocks } from "./translate.js";

describe("parseNumberedBlocks", () => {
  it("按编号取回每一块", () => {
    const text = "<<<1>>>\n你好\n<<<2>>>\n世界\n";
    expect(parseNumberedBlocks(text, 2)).toEqual(["你好", "世界"]);
  });

  it("缺块时失败", () => {
    expect(() => parseNumberedBlocks("<<<1>>>\n只有一块\n", 2)).toThrow("译文缺块 2/2");
  });

  it("超出范围的编号不算新块", () => {
    const text = "<<<1>>>\n你好\n<<<3>>>\n仍属第一块\n<<<2>>>\n世界";
    expect(parseNumberedBlocks(text, 2)).toEqual(["你好\n<<<3>>>\n仍属第一块", "世界"]);
  });
});

describe("looksTranslated", () => {
  it("长原文必须出现中文，且不能原样返回", () => {
    const original = "This sentence is definitely longer than twenty four characters.";
    expect(looksTranslated(original, "这句话已经译成中文了")).toBe(true);
    expect(looksTranslated(original, original)).toBe(false);
    expect(looksTranslated(original, "   ")).toBe(false);
  });

  it("短于 24 字时，原样英文也算通过", () => {
    expect(looksTranslated("Short title", "Short title")).toBe(true);
  });

  it("表格要还是一张表", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(looksTranslated(table, "| 甲 | 乙 |\n| --- | --- |")).toBe(true);
    expect(looksTranslated(table, "这不是表")).toBe(false);
  });
});

describe("packSectionGroups", () => {
  it("每组最多三节", () => {
    const units = ["intro", "## A\na", "## B\nb", "## C\nc", "## D\nd"];
    const groups = packSectionGroups(units);
    expect(groups).toEqual([
      ["intro", "## A\na", "## B\nb"],
      ["## C\nc", "## D\nd"],
    ]);
  });
});
