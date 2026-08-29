import {describe, expect, it} from "vitest";
import {personaAvatarSrc, safeImageSrc} from "./PersonaAvatar";

describe("safeImageSrc", () => {
    it("allows blob, image data URLs and same-origin relative paths", () => {
        expect(safeImageSrc("blob:https://app.example/abc")).toBe("blob:https://app.example/abc");
        expect(safeImageSrc("data:image/jpeg;base64,abc")).toBe("data:image/jpeg;base64,abc");
        expect(safeImageSrc("/personas/megaphone.svg")).toBe("/personas/megaphone.svg");
        expect(safeImageSrc("/api/drill-instructor/persona/1/picture/")).toBe(
            "/api/drill-instructor/persona/1/picture/",
        );
    });

    it("allows Capacitor disk-cache URLs so APK coach portraits render", () => {
        const android = "https://localhost/_capacitor_file_/data/user/0/app/cache/wc-media/ab";
        const ios = "capacitor://localhost/_capacitor_file_/var/mobile/Containers/Data/ab";
        const content = "https://localhost/_capacitor_content_/media/external/images/1";
        expect(safeImageSrc(android)).toBe(android);
        expect(safeImageSrc(ios)).toBe(ios);
        expect(safeImageSrc(content)).toBe(content);
    });

    it("refuses attacker-controlled or exotic src values", () => {
        expect(safeImageSrc("//evil.example/x")).toBeNull();
        expect(safeImageSrc("https://evil.example/x.jpg")).toBeNull();
        expect(safeImageSrc("javascript:alert(1)")).toBeNull();
        expect(safeImageSrc("data:text/html;base64,abc")).toBeNull();
        expect(safeImageSrc("https://evil.example/_capacitor_file_/x")).toBeNull();
        expect(safeImageSrc("https://localhost.evil.example/_capacitor_file_/x")).toBeNull();
        expect(safeImageSrc("https://localhost/not-capacitor/x")).toBeNull();
        expect(safeImageSrc(null)).toBeNull();
        expect(safeImageSrc("")).toBeNull();
    });
});

describe("personaAvatarSrc", () => {
    it("maps artwork keys to bundled SVGs", () => {
        expect(personaAvatarSrc("megaphone")).toBe("/personas/megaphone.svg");
        expect(personaAvatarSrc("🎖️")).toBeNull();
        expect(personaAvatarSrc("../x")).toBeNull();
    });
});
