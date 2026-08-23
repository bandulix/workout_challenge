import {Camera, CameraResultType, CameraSource} from "@capacitor/camera";
import {Capacitor} from "@capacitor/core";
import {isNativeApp} from "./serverUrl";

// Native camera / gallery for the Android APK. The WebView ignores
// <input capture="user"> and opens the file picker for both buttons,
// and Android often labels photos as image/heic or application/octet-stream
// which a strict MIME allow-list rejects. Camera.getPhoto() actually
// opens the camera vs the library, and returns a JPEG we can upload.

export function isNativeCameraAvailable() {
    return isNativeApp() && Capacitor.isPluginAvailable("Camera");
}

export function isPhotoPickCancel(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return msg.includes("cancel") || msg.includes("dismiss") || msg.includes("user cancelled");
}

/** True unless the file is a clearly-not-a-bitmap type (SVG/HTML).
 *  Empty type and octet-stream are allowed - Android omits MIME a lot. */
export function isAcceptablePhoto(file) {
    if (!file) return false;
    const t = (file.type || "").toLowerCase();
    if (!t || t === "application/octet-stream") return true;
    if (/^(image\/svg\+xml|text\/|application\/(xhtml|xml|javascript))/i.test(t)) return false;
    if (t.startsWith("image/")) return true;
    return false;
}

/**
 * @param {"camera"|"gallery"|"prompt"} source
 * @returns {Promise<File|null>} File, or null if native pick is unavailable
 *   (caller should fall back to <input type=file>).
 */
export async function pickNativePhoto(source) {
    if (!isNativeCameraAvailable()) return null;
    const sourceMap = {
        camera: CameraSource.Camera,
        prompt: CameraSource.Prompt,
        gallery: CameraSource.Photos,
    };
    const photo = await Camera.getPhoto({
        quality: 85,
        width: 1920,
        resultType: CameraResultType.Uri,
        source: sourceMap[source] || CameraSource.Photos,
        correctOrientation: true,
    });
    const path = photo.webPath;
    if (!path) return null;
    const blob = await (await fetch(path)).blob();
    const format = (photo.format || "jpeg").toLowerCase().replace("jpg", "jpeg");
    let type = (blob.type || "").toLowerCase();
    if (!type || type === "application/octet-stream") type = `image/${format}`;
    if (type === "image/jpg") type = "image/jpeg";
    const ext = format === "jpeg" ? "jpg" : format;
    return new File([blob], `photo.${ext}`, {type});
}
