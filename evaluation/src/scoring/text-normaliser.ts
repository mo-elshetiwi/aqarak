/** Maps Arabic-Indic and extended Arabic-Indic digits to Western digits. */
export function normaliseDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/gu, (digit) =>
    String(digit.charCodeAt(0) - (digit >= "\u06F0" ? 0x06f0 : 0x0660)),
  );
}

/** Normalises text with letter rules mirroring CAMeL Tools' normalize_alef_ar, normalize_alef_maksura_ar, normalize_teh_marbuta_ar and dediac_ar. */
export function normaliseText(text: string): string {
  return normaliseDigits(
    text
      .normalize("NFKC")
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/gu, "")
      .replace(/\u0640/gu, "")
      .replace(/[\u0622\u0623\u0625\u0671]/gu, "\u0627")
      .replace(/\u0649/gu, "\u064A")
      .replace(/\u0629/gu, "\u0647"),
  )
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Splits normalised text into nonempty word tokens. */
export function tokenise(text: string): readonly string[] {
  const normalised = normaliseText(text);
  return normalised === "" ? [] : normalised.split(" ");
}
