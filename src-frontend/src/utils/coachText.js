const CHARACTER_COUNT_SUFFIX_RE = /\s*\(\s*\d+\s*(?:zeichen|characters?|chars?)\s*\)([.!?])?\s*$/i;

export function stripCharacterCountSuffix(text) {
    if (!text) return text;
    return text.replace(CHARACTER_COUNT_SUFFIX_RE, "$1").trim();
}
