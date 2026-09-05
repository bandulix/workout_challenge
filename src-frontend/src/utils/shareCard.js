import {fetchProtectedImage} from "./protectedMedia";
import {notice} from "./dialogs";

const CARD_W = 1080;
const CARD_H = 1350;

function wrapLines(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines.slice(0, 8);
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function composeCard({title, text, imageSrc}) {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    if (imageSrc) {
        try {
            const img = await loadImage(imageSrc);
            const scale = Math.max(CARD_W / img.width, (CARD_H * 0.72) / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (CARD_W - w) / 2, 0, w, h);
        } catch (err) {
            // Caption-only card if the picture cannot load.
        }
    }

    const fadeTop = CARD_H * 0.52;
    const fade = ctx.createLinearGradient(0, fadeTop, 0, CARD_H);
    fade.addColorStop(0, "rgba(11,11,12,0)");
    fade.addColorStop(0.35, "rgba(11,11,12,0.75)");
    fade.addColorStop(1, "#0b0b0c");
    ctx.fillStyle = fade;
    ctx.fillRect(0, fadeTop, CARD_W, CARD_H - fadeTop);

    ctx.fillStyle = "#d7ff3e";
    ctx.font = "700 36px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("WORKOUT CHALLENGE", 64, CARD_H - 280);

    ctx.fillStyle = "#f4f4f5";
    ctx.font = "800 52px ui-sans-serif, system-ui, sans-serif";
    const titleLines = wrapLines(ctx, title || "", CARD_W - 128);
    let y = CARD_H - 220;
    for (const line of titleLines.slice(0, 2)) {
        ctx.fillText(line, 64, y);
        y += 60;
    }

    ctx.fillStyle = "#d4d4d8";
    ctx.font = "500 36px ui-sans-serif, system-ui, sans-serif";
    for (const line of wrapLines(ctx, text || "", CARD_W - 128)) {
        ctx.fillText(line, 64, y);
        y += 46;
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return null;
    return new File([blob], "workout-share.jpg", {type: "image/jpeg"});
}

export async function sharePostCard({title, text, imageUrl}) {
    const caption = [title, text].filter(Boolean).join("\n");
    let file = null;
    if (imageUrl) {
        const src = await fetchProtectedImage(imageUrl);
        if (src) file = await composeCard({title, text, imageSrc: src});
    }
    if (!file) file = await composeCard({title, text, imageSrc: null});

    try {
        if (file && navigator.canShare?.({files: [file]})) {
            await navigator.share({title: title || "Workout Challenge", text: caption, files: [file]});
            return;
        }
        if (navigator.share) {
            await navigator.share({title: title || "Workout Challenge", text: caption});
            return;
        }
        if (file) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(file);
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(a.href);
        }
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(caption);
        notice(file ? "Saved the picture." : "Copied the text.");
    } catch (err) {
        if (err && err.name === "AbortError") return;
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(caption);
            notice("Copied the text.");
        } catch (clipErr) {
            notice("Could not share.");
        }
    }
}
