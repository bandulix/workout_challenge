/** Ski-week copy in the coach's reply language. English is the app default. */

const COPY = {
    en: {
        day: "Day",
        days: "Days",
        hour: "Hour",
        hours: "Hours",
        minute: "Min",
        minutes: "Min",
        second: "Sec",
        seconds: "Sec",
        freshSnow: "{cm} cm fresh snow",
        valley: "Valley",
        summit: "Summit",
        today: "Today",
        vertical: "Vertical",
        runs: "Runs",
        open: "Piste open",
        live: "The week is live.",
        snowReport: "Snow report",
        weather: "Weather",
        freezing: "freezing level {m} m",
        forecastLater: "The opening-day forecast arrives inside the 7-day window.",
        share: "Share",
        sambucaLead: "Sambuca lead",
        shared: "shared",
        joined: "Joined",
        week: "Week",
        points: "Points",
        piste: "Piste",
        sambuca: "Sambuca",
        emptyBoard: "Nothing on the board yet.",
        crownOpen: "The crown is open.",
        crown: "Crown",
        close: "Close",
        finale: "Finale",
        awards: "Awards",
        sambuca_royalty: "Sambuca King/Queen",
        erste_liftfahrt: "First lift",
        meiste_hoehenmeter: "Most vertical",
        laengster_skitag: "Longest ski day",
        fruehstarter: "Early start",
        most_improved: "Most improved",
        water_streak: "Water streak",
        hutTitle: "Hut magic",
        hutHint: "An evening group photo becomes a hut postcard.",
        splitTitle: "Slope me / evening me",
        splitHint: "One slope photo and one evening photo.",
        slopePhoto: "Slope photo",
        eveningPhoto: "Evening photo",
        selfie: "Fresh selfie",
        coronation: "Coronation",
        photoReady: "The coach kept your photo.",
        attribution: "Weather and snow: Open-Meteo.com",
        ended: "Ended",
        champTitle: "Sambuca Champ",
        dayN: "Day {n}",
        yesterdayCrown: "Yesterday's crown",
        wearsCrown: "{names} wears the crown · {count}.",
        shareCrown: "{names} share the crown · {count}.",
        undo: "Undo last",
        addOne: "Add one",
        copied: "Countdown copied.",
        shareFailed: "Could not share the countdown.",
        ready: "Ready",
    },
    de: {
        day: "Tag",
        days: "Tage",
        hour: "Stunde",
        hours: "Stunden",
        minute: "Min",
        minutes: "Min",
        second: "Sek",
        seconds: "Sek",
        freshSnow: "{cm} cm Neuschnee",
        valley: "Tal",
        summit: "Berg",
        today: "Heute",
        vertical: "Höhenmeter",
        runs: "Abfahrten",
        open: "Piste offen",
        live: "Die Woche läuft.",
        snowReport: "Schneebericht",
        weather: "Wetter",
        freezing: "Nullgradgrenze {m} m",
        forecastLater: "Die Prognose für die ersten Skitage kommt im 7-Tage-Fenster.",
        share: "Teilen",
        sambucaLead: "Sambuca-Führung",
        shared: "geteilt",
        joined: "Dabei",
        week: "Woche",
        points: "Punkte",
        piste: "Piste",
        sambuca: "Sambuca",
        emptyBoard: "Noch nichts auf der Tafel.",
        crownOpen: "Die Krone ist offen.",
        crown: "Krone",
        close: "Schliessen",
        finale: "Finale",
        awards: "Auszeichnungen",
        sambuca_royalty: "Sambuca-König/Königin",
        erste_liftfahrt: "Erste Liftfahrt",
        meiste_hoehenmeter: "Meiste Höhenmeter",
        laengster_skitag: "Längster Skitag",
        fruehstarter: "Frühstarter",
        most_improved: "Grösster Sprung",
        water_streak: "Wasser-Serie",
        hutTitle: "Hüttenzauber",
        hutHint: "Ein Abendfoto wird zur Hüttenkarte.",
        splitTitle: "Pisten-Ich / Après-Ich",
        splitHint: "Ein Pistenfoto und ein Abendfoto.",
        slopePhoto: "Pistenfoto",
        eveningPhoto: "Abendfoto",
        selfie: "Neues Selfie",
        coronation: "Krönung",
        photoReady: "Der Coach behält dein Foto.",
        attribution: "Wetter und Schnee: Open-Meteo.com",
        ended: "Beendet",
        champTitle: "Sambuca-Champ",
        dayN: "Tag {n}",
        yesterdayCrown: "Krone von gestern",
        wearsCrown: "{names} trägt die Krone · {count}.",
        shareCrown: "{names} teilen sich die Krone · {count}.",
        undo: "Letzten zurück",
        addOne: "Eins dazu",
        copied: "Countdown kopiert.",
        shareFailed: "Teilen hat nicht geklappt.",
        ready: "Bereit",
    },
};

const WEATHER = {
    en: {clear: "Clear", clouds: "Clouds", fog: "Fog", rain: "Rain", snow: "Snow", storm: "Storm", mixed: "Mixed"},
    de: {clear: "Klar", clouds: "Wolken", fog: "Nebel", rain: "Regen", snow: "Schnee", storm: "Gewitter", mixed: "Wechselhaft"},
};

export function skiLocale(language) {
    const code = String(language || "en").toLowerCase();
    if (code.startsWith("de")) return "de";
    return "en";
}

export function skiT(language, key, vars = {}) {
    const table = COPY[skiLocale(language)] || COPY.en;
    let text = table[key] || COPY.en[key] || key;
    Object.entries(vars).forEach(([name, value]) => {
        text = text.replace(`{${name}}`, String(value));
    });
    return text;
}

export function unitLabel(language, count, oneKey, manyKey) {
    return skiT(language, Number(count) === 1 ? oneKey : manyKey);
}

function weatherKey(code) {
    const n = Number(code);
    if (n === 0) return "clear";
    if (n === 1 || n === 2 || n === 3) return "clouds";
    if (n === 45 || n === 48) return "fog";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(n)) return "rain";
    if ([71, 73, 75, 77, 85, 86].includes(n)) return "snow";
    if (n === 95 || n === 96 || n === 99) return "storm";
    return "mixed";
}

export function forecastDay(language, iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!match) return "";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const de = skiLocale(language) === "de";
    const weekday = date.toLocaleDateString(de ? "de-DE" : "en-GB", {weekday: "short"}).replace(".", "");
    if (de) return `${weekday} ${date.getDate()}.${date.getMonth() + 1}.`;
    const month = date.toLocaleDateString("en-GB", {month: "short"});
    return `${weekday} ${date.getDate()} ${month}`;
}

export function weatherName(language, code) {
    if (code == null || code === "") return "";
    const table = WEATHER[skiLocale(language)] || WEATHER.en;
    return table[weatherKey(code)] || table.mixed;
}
