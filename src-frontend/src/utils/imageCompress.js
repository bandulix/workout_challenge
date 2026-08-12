// Client-side photo compression for the coach feed: phone cameras
// produce 3-12 MB files; downscaling to a feed-sized JPEG keeps storage
// small and the feed fast. The canvas re-encode also strips EXIF
// (location!) and rotation is applied, so pictures render upright.
//
// GIFs pass through untouched (canvas would kill the animation), as do
// images that already fit the budget - recompressing a small JPEG only
// makes it uglier.

const MAX_DIMENSION = 1600; // px, longest edge
const JPEG_QUALITY = 0.82;
const SKIP_BYTES = 400 * 1024; // already small enough - don't touch

export async function compressImage(file) {
    if (!file || !file.type?.startsWith("image/")) return file;
    if (file.type === "image/gif") return file;
    if (file.size <= SKIP_BYTES) return file;

    let bitmap;
    try {
        bitmap = await createImageBitmap(file, {imageOrientation: "from-image"});
    } catch {
        return file; // undecodable in this browser - server validation decides
    }
    try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
        // Nothing to gain when the file already fits the frame.
        if (scale === 1 && file.type === "image/jpeg") return file;

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
        );
        if (!blob || blob.size >= file.size) return file; // no win - keep original
        const name = (file.name || "photo").replace(/\.[a-z0-9]+$/i, "") + ".jpg";
        return new File([blob], name, {type: "image/jpeg"});
    } finally {
        bitmap.close?.();
    }
}
