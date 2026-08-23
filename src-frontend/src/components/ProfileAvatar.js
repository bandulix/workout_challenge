import React, {useEffect, useRef, useState} from "react";
import {Camera, Crown, Megaphone} from "lucide-react";
import {BeatLoader} from "react-spinners";
import {useUploadProfilePictureMutation} from "../utils/reducers/usersSlice";
import {invalidateProtectedImage, useProtectedImage} from "../utils/protectedMedia";
import {isAcceptablePhoto, isPhotoPickCancel, pickNativePhoto} from "../utils/nativeCamera";

// The user's profile picture with an optional camera-badge edit affordance.
// Uploads go straight to PATCH /api/user/me/ as multipart form data.
//
// Profile pictures are not public: the API hands out an authenticated
// endpoint URL, which <img> can't load directly (no JWT header) - it is
// fetched with credentials and rendered from an object URL.

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif";
const FALLBACK = "/profile.png";

function echoHoldCount(user) {
    const n = Number(user?.echoes_held);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function EchoCrown({count, size}) {
    if (!count) return null;
    const badge = Math.max(16, Math.round(size * 0.38));
    const icon = Math.max(9, Math.round(badge * 0.55));
    const label = count === 1 ? "Holds a Legend Echo" : `Holds ${count} Legend Echoes`;
    return (
        <span title={label}
              className="absolute -top-1 -right-1 z-10 rounded-full bg-volt-400 text-ink-950 border border-ink-950 flex items-center justify-center shadow-glow-volt"
              style={{width: badge, height: badge}}>
            <Crown style={{width: icon, height: icon}} strokeWidth={2.5}/>
            <span className="sr-only">{label}</span>
        </span>
    );
}

function ProfileAvatar({user, size = 96, editable = false, className = "", dunce = false}) {
    const fileInput = useRef(null);
    const [upload, {isLoading}] = useUploadProfilePictureMutation();
    const [error, setError] = useState(null);

    const pictureUrl = user?.profile_picture;
    const {src: fetchedSrc, failed: fetchFailed} = useProtectedImage(pictureUrl || null);
    const [imgFailed, setImgFailed] = useState(false);
    useEffect(() => { setImgFailed(false); }, [pictureUrl, fetchedSrc]);
    const src = (!fetchFailed && !imgFailed && fetchedSrc) || FALLBACK;

    async function handlePicked(file) {
        if (!file) return;
        setError(null);
        if (file.size > 5 * 1024 * 1024) {
            setError("Image too large (max 5 MB).");
            return;
        }
        if (!isAcceptablePhoto(file)) {
            setError("Please pick a photo (JPEG, PNG, WebP, GIF or HEIC).");
            return;
        }
        try {
            await upload(file).unwrap();
            // The picture URL is stable - drop the cached old blob so the
            // fresh upload actually renders.
            invalidateProtectedImage(pictureUrl);
        } catch (err) {
            const msg = err?.data?.profile_picture_upload;
            setError(Array.isArray(msg) ? msg[0] : "Upload failed - please try again.");
        }
    }

    function handleFile(e) {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow re-picking the same file
        handlePicked(file);
    }

    async function openPicker() {
        try {
            const native = await pickNativePhoto("prompt");
            if (native) {
                await handlePicked(native);
                return;
            }
        } catch (err) {
            if (isPhotoPickCancel(err)) return;
        }
        fileInput.current?.click();
    }

    const img = (
        <img
            src={src}
            alt={user?.first_name ? `${user.first_name}'s profile picture` : "Profile picture"}
            className="rounded-full object-cover w-full h-full select-none"
            draggable={false}
            onError={() => { if (src !== FALLBACK) setImgFailed(true); }}
        />
    );

    const holds = echoHoldCount(user);

    if (!editable) {
        return (
            <div className={"relative shrink-0 rounded-full " + className} style={{width: size, height: size}}>
                {img}
                {dunce && (
                    <span title="Dunce megaphone — last on the board until they log"
                          className="absolute -top-1 -left-1 z-10 h-5 w-5 rounded-full bg-ink-950 border border-volt-400 text-volt-400 flex items-center justify-center">
                        <Megaphone className="h-3 w-3"/>
                    </span>
                )}
                <EchoCrown count={holds} size={size}/>
            </div>
        );
    }

    return (
        <div className={"relative shrink-0 " + className} style={{width: size, height: size}}>
            <button
                type="button"
                onClick={openPicker}
                className="group relative block w-full h-full rounded-full overflow-hidden ring-2 ring-volt-400/60 focus:outline-none focus:ring-volt-400"
                aria-label="Change profile picture"
            >
                {img}
                <span className="absolute inset-0 bg-ink-950/45 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition flex items-center justify-center">
                    {isLoading
                        ? <BeatLoader size={6} color="#d7ff3e"/>
                        : <Camera className="h-6 w-6 text-volt-400"/>}
                </span>
            </button>
            <EchoCrown count={holds} size={size}/>
            <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-volt-400 text-ink-950 flex items-center justify-center shadow-glow-volt pointer-events-none">
                <Camera className="h-4 w-4"/>
            </span>
            <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={handleFile}/>
            {error && (
                <p className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-48 text-center text-xs text-red-500">{error}</p>
            )}
        </div>
    );
}

export default ProfileAvatar;
