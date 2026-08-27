import React, {useEffect, useState} from "react";
import {ChevronDown, ChevronUp, MessageCircle, Send} from "lucide-react";
import {useDispatch} from "react-redux";
import {BeatLoader} from "react-spinners";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {drillInstructorApi, useReplyToDrillMessageMutation} from "../utils/reducers/drillInstructorSlice";
import {useProtectedImage} from "../utils/protectedMedia";
import {elapsedSince, timeAgo} from "../utils/time";

// A reply's image (the coach's roasted-photo remix) - authenticated
// endpoint, so loaded through the protected-media cache like avatars.
function ReplyImage({url, alt, elapsed}) {
    const {src} = useProtectedImage(url);
    if (!src) return null;
    return (
        <div className="relative mt-1.5 overflow-hidden rounded-xl">
            <img src={src} alt={alt} className="max-h-72 w-auto max-w-full"/>
            {elapsed && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-ink-950/75 text-volt-400 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 tabular-nums">
                    {elapsed}
                </span>
            )}
        </div>
    );
}

// Conversation thread under a top-level coach message: participants of
// the challenge reply, the coach reacts in its persona's voice (async,
// a few seconds later). One level deep on purpose - sub-threads would
// only confuse the chat UI.
//
// Coach bubbles use the persona's avatar/accent, participant bubbles the
// user's profile picture + first name, so it is always clear who spoke.

function CoachThread({message, persona, canReply = true, defaultOpen = false, className = "mt-2.5", trailing = null}) {
    const [open, setOpen] = useState(defaultOpen);
    // Deep links pass defaultOpen; the messages query usually resolves
    // after the first render, so sync the prop in when it flips true.
    useEffect(() => {
        if (defaultOpen) setOpen(true);
    }, [defaultOpen]);
    const [text, setText] = useState("");
    const [error, setError] = useState(null);
    const [sendReply, {isLoading}] = useReplyToDrillMessageMutation();
    const dispatch = useDispatch();
    // The original upload is the activity-card answer; the coach remix
    // is the backdrop and the hot-or-not box. Neither belongs in chat.
    const replies = (message.replies || []).filter(
        (r) => r.kind !== "photo" && !(r.is_coach && r.image)
    );
    const pictured = Boolean(message.image) || replies.some((r) => r.image);
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!open || !pictured) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [open, pictured]);

    // Benched coach (disabled config): existing threads stay readable,
    // but new replies are pointless - the coach can't react.
    if (!canReply && replies.length === 0) return null;

    async function handleSend() {
        const body = text.trim();
        if (!body || isLoading) return;
        setError(null);
        try {
            await sendReply({id: message.id, body}).unwrap();
            setText("");
            setOpen(true);
            // The coach's reaction is generated asynchronously (usually a
            // few seconds) - two delayed re-fetches pick it up quickly,
            // the regular 60s poll is the backstop.
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage'])), 8000);
            setTimeout(() => dispatch(drillInstructorApi.util.invalidateTags(['DrillMessage'])), 20000);
        } catch (err) {
            setError(err?.data?.body || "Could not send your reply - please try again.");
        }
    }

    return (
        <div className={"min-w-0 w-full " + className}>
            <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-full btn-glass px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-volt-700 dark:hover:text-volt-300 transition min-h-[32px]">
                <MessageCircle className="h-3.5 w-3.5"/>
                {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : (canReply ? "Reply" : "")}
                {(canReply || replies.length > 0) && (open ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>)}
            </button>
            {trailing}
            </div>

            {open && (
                <div className="mt-2 space-y-2.5 min-w-0">
                    {replies.map((r) => (
                        <div key={r.id} className="flex items-start gap-2">
                            {r.is_coach ? (
                                <PersonaAvatar persona={persona} size={24}/>
                            ) : (
                                <ProfileAvatar user={{profile_picture: r.author_profile_picture, first_name: r.author_name}} size={24}/>
                            )}
                            <div className={"min-w-0 flex-1 rounded-2xl px-3 py-2 " +
                                (r.is_coach ? "glass-inset" : "bg-ink-950/[0.04] dark:bg-white/[0.05]")}>
                                {/* break-words: pasted URLs / unbreakable strings wrap
                                    instead of overflowing the viewport (page scrolled
                                    sideways on smartphones). */}
                                <p className="text-sm leading-snug break-words dark:text-gray-100">{r.body}</p>
                                {r.image && (
                                    <ReplyImage url={r.image}
                                                alt={r.body ? `Coach remix: ${r.body}` : "Coach remix"}
                                                elapsed={elapsedSince(r.posted_at, now)}/>
                                )}
                                <p className="text-[11px] text-gray-400 mt-1">
                                    {r.is_coach ? (persona?.name || "Coach") : (r.author_name || "Participant")} · {timeAgo(r.posted_at)}
                                </p>
                            </div>
                        </div>
                    ))}

                    {canReply && (
                        <div className="min-w-0 w-full space-y-1">
                            <div className="flex items-center gap-2 min-w-0 w-full">
                                <input
                                    type="text"
                                    value={text}
                                    maxLength={500}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                                    placeholder={`Reply to ${persona?.name || "the coach"}…`}
                                    aria-label={`Reply to ${persona?.name || "the coach"}`}
                                    className="min-w-0 w-0 flex-1 min-h-[44px] h-11 border border-ink-950/10 dark:border-ink-700/60 rounded-full py-2 px-3 sm:px-4 text-sm text-gray-800 bg-white/55 dark:bg-ink-900 dark:text-gray-300 dark:placeholder-gray-600 leading-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-none focus:outline-none focus:border-volt-500"
                                />
                                <button onClick={handleSend} disabled={isLoading || !text.trim()}
                                        aria-label="Send reply"
                                        className="shrink-0 h-11 w-11 min-h-[44px] min-w-[44px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none flex items-center justify-center">
                                    {isLoading ? <BeatLoader size={5} color="#0b0b0c"/> : <Send className="h-4 w-4"/>}
                                </button>
                            </div>
                            {error && <p className="text-xs text-red-500">{error}</p>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default CoachThread;
