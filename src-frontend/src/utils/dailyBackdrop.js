// One action plate per calendar day. Same id for every user on a given
// local date so a refresh does not swap the scene.
// Keep BACKDROP_IDS and the FNV-1a mix in lockstep with public/theme-init.js
// (that file preloads today's plate before React boots).
export const BACKDROP_IDS = ["snowboard", "swim", "gravel", "studio", "lift"];

export function dailyBackdropId(date = new Date()) {
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    let h = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return BACKDROP_IDS[(h >>> 0) % BACKDROP_IDS.length];
}

export function backdropUrls(night, date) {
    const id = dailyBackdropId(date);
    const suffix = night ? "" : "-light";
    return {
        webp: `/backdrops/${id}${suffix}.webp`,
        jpg: `/backdrops/${id}${suffix}.jpg`,
    };
}
