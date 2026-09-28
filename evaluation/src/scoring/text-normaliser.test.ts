import { describe, expect, it } from "vitest";
import { normaliseDigits, normaliseText, tokenise } from "./text-normaliser.js";

describe("normaliseText", () => {
  it("applies Unicode NFKC", () => {
    expect(normaliseText("ＡＢＣ ﬁ")).toBe("abc fi");
  });
  it("removes Arabic diacritics", () => {
    expect(normaliseText("عَرَبِيّ\u0670\u065f")).toBe("عربي");
  });
  it("removes Quranic marks", () => {
    expect(normaliseText("ن\u06d6\u06ed")).toBe("ن");
  });
  it("removes tatweel", () => {
    expect(normaliseText("ســلام")).toBe("سلام");
  });
  it("maps every alef form", () => {
    expect(normaliseText("آأإٱ")).toBe("اااا");
  });
  it("maps alef maksura", () => {
    expect(normaliseText("على")).toBe("علي");
  });
  it("maps teh marbuta", () => {
    expect(normaliseText("مدرسة")).toBe("مدرسه");
  });
  it("maps both digit scripts", () => {
    expect(normaliseDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹")).toBe(
      "0123456789 0123456789",
    );
  });
  it("lowercases English", () => {
    expect(normaliseText("PoDCast")).toBe("podcast");
  });
  it("replaces Unicode punctuation and symbols", () => {
    expect(normaliseText("a،b؛c؟d€e🙂f")).toBe("a b c d e f");
  });
  it("collapses whitespace and trims", () => {
    expect(normaliseText(" \t a\n  b\u00a0 ")).toBe("a b");
  });
  it("normalises mixed Arabic and English brackets and digits", () => {
    expect(
      normaliseText("أهلًا ... [podcast think with hessa] الحلقة ١٩ و ۲۰"),
    ).toBe("اهلا podcast think with hessa الحلقه 19 و 20");
  });
  it("ignores bracket order around an article number", () => {
    expect(normaliseText("المادة (19)")).toBe(normaliseText("( المادة 19 )"));
  });
  it("is idempotent", () => {
    const text = "أهلًا [HELLO] ۱۲؟";
    expect(normaliseText(normaliseText(text))).toBe(normaliseText(text));
  });
  it("returns no empty tokens", () => {
    expect(tokenise(" ، ؟ ")).toEqual([]);
    expect(tokenise(" أ  B ")).toEqual(["ا", "b"]);
  });
});
