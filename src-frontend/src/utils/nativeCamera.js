import {Camera, CameraDirection, CameraResultType, CameraSource, MediaTypeSelection} from "@capacitor/camera";
import {Capacitor} from "@capacitor/core";
import {isNativeApp} from "./serverUrl";

// Native camera / gallery for the Android APK. The WebView ignores
// <input capture="user"> (especially when the input is hidden and
// clicked from JS) and opens the file picker for both buttons.
// Camera.takePhoto() / chooseFromGallery() actually open the camera
// vs the library. The deprecated getPhoto(Camera) path wrote into
// app Pictures/, which this app's FileProvider did not share, so the
// plugin threw and the JS fallback clicked the HTML input — gallery.

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

async function fileFromPath(path, formatHint) {
    if (!path) return null;
    const blob = await (await fetch(path)).blob();
    const format = (formatHint || "jpeg").toLowerCase().replace("jpg", "jpeg");
    let type = (blob.type || "").toLowerCase();
    if (!type || type === "application/octet-stream") type = `image/${format}`;
    if (type === "image/jpg") type = "image/jpeg";
    const ext = format === "jpeg" ? "jpg" : format;
    return new File([blob], `photo.${ext}`, {type});
}

function mediaPath(photo) {
    if (!photo) return null;
    if (photo.webPath) return photo.webPath;
    if (photo.uri) return Capacitor.convertFileSrc(photo.uri);
    return null;
}

function mediaFormat(photo) {
    return photo?.format || photo?.metadata?.format || "jpeg";
}

/**
 * @param {"camera"|"gallery"|"prompt"} source
 * @returns {Promise<File|null>} File, or null if native pick is unavailable
 *   (caller should fall back to <input type=file> on the web only).
 */
export async function pickNativePhoto(source) {
    if (!isNativeCameraAvailable()) return null;

    if (source === "camera") {
        const photo = await Camera.takePhoto({
            quality: 85,
            targetWidth: 1920,
            targetHeight: 1920,
            correctOrientation: true,
            saveToGallery: false,
            cameraDirection: CameraDirection.Rear,
        });
        return fileFromPath(mediaPath(photo), mediaFormat(photo));
    }

    if (source === "gallery") {
        const picked = await Camera.chooseFromGallery({
            mediaType: MediaTypeSelection.Photo,
            allowMultipleSelection: false,
            quality: 85,
        });
        const item = picked?.results?.[0];
        return fileFromPath(mediaPath(item), mediaFormat(item));
    }

    const photo = await Camera.getPhoto({
        quality: 85,
        width: 1920,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        correctOrientation: true,
    });
    return fileFromPath(photo.webPath, photo.format);
}
