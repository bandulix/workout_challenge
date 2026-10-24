import React, {useEffect, useState} from "react";
import {ChevronDown, ChevronUp, MessageCircle, Send, ThumbsDown, ThumbsUp} from "lucide-react";
import {useDispatch} from "react-redux";
import {BeatLoader} from "react-spinners";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {drillInstructorApi, useReplyToDrillMessageMutation} from "../utils/reducers/drillInstructorSlice";
import {useProtectedImage} from "../utils/protectedMedia";
import {elapsedSince, timeAgo} from "../utils/time";
import {RoastGallery} from "./gameBits";
import {stripCharacterCountSuffix} from "../utils/coachText";
import {accentHex} from "./gameBits";

function CoachFeedback({id}) {
    const storageKey = `wc-coach-fb:${id}`;
    const [vote, setVote] = useState(() => {
        try { return localStorage.getItem(storageKey) || ""; } catch { return ""; }
    });
    function choose(next) {
        const value = vote === next ? "" : next;
        setVote(value);
        try {
            if (value) localStorage.setItem(storageKey, value);
            else localStorage.removeItem(storageKey);
        } catch { /* private mode */ }
    }
    const button = "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full ";
    return (
        <div className="mt-1 flex">
            <button type="button" aria-label="Helpful" aria-pressed={vote === "up"} onClick={() => choose("up")}
                    className={button + (vote === "up" ? "bg-volt-400 text-ink-950" : "text-muted")}>
                <ThumbsUp className="h-4 w-4" aria-hidden="true"/>
            </button>
            <button type="button" aria-label="Not helpful" aria-pressed={vote === "down"} onClick={() => choose("down")}
                    className={button + (vote === "down" ? "bg-ink-700 text-white" : "text-muted")}>
                <ThumbsDown className="h-4 w-4" aria-hidden="true"/>
            </button>
        </div>
    );
}

function ReplyImage({url, alt, elapsed}) {
    // Card JPEG in the thread; the gallery fetches the original.
    const {src} = useProtectedImage(url, "card");
    const [open, setOpen] = useState(false);
    if (!src) return null;
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}
                    className="relative mt-1.5 overflow-hidden rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-volt-400">
                <img src={src} alt={alt} className="max-h-72 w-auto max-w-full"/>
                {elapsed && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-ink-950/75 text-white text-xs font-bold uppercase tracking-wider px-2 py-0.5 tabular-nums">
                        {elapsed}
                    </span>
                )}
            </button>
            {open && (
                <RoastGallery
                    cards={[{image: url, title: alt || "Photo", caption: ""}]}
                    index={0} onIndex={() => {}} onClose={() => setOpen(false)}/>
            )}
        </>
    );
}

// Conversation thread under a top-level coach message: participants of
// the challenge reply, the coach reacts in its persona's voice (async,
// a few seconds later). One level deep on purpose - sub-threads would
// only confuse the chat UI.
//
// Coach bubbles use the persona's avatar/accent, participant bubbles the
// user's profile picture + first name, so it is always clear who spoke.

function CoachBody({text}) {
    const lines = String(text || "").split("\n").map((line) => line.trimEnd()).filter((line) => line.trim());
    if (lines.length < 2) {
        return <p className="text-sm leading-snug break-words dark:text-gray-100">{text}</p>;
    }
    return (
        <div className="space-y-1 text-sm leading-snug break-words dark:text-gray-100">
            {lines.map((line, index) => (
                line.startsWith("- ") || line.startsWith("• ")
                    ? <p key={index} className="pl-3">• {line.replace(/^[-•]\s+/, "")}</p>
                    : <p key={index} className={index === 0 ? "font-semibold" : ""}>{line}</p>
            ))}
        </div>
    );
}

const SUGGESTIONS = ["Roast me", "Plan tomorrow"];

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
    // Coach remix is the activity-card backdrop (and hot-or-not) — not
    // a chat bubble. Original photo uploads stay in the thread so they
    // open only when the user taps replies.
    const accent = accentHex(persona?.theme_color);
    const replies = (message.replies || []).filter(
        (r) => !(r.is_coach && r.image)
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
                    aria-label={replies.length > 0 ? undefined : "Replies"}
                    className="inline-flex items-center gap-1.5 rounded-full btn-glass px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-ink-950 dark:hover:text-white transition min-h-[44px]">
                <MessageCircle className="h-3.5 w-3.5"/>
                {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : (canReply ? "Reply" : "")}
                {(canReply || replies.length > 0) && (open ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>)}
            </button>
            {trailing}
            </div>

            {open && (
                <div className="mt-2 space-y-2.5 min-w-0">
                    {replies.filter((r) => (r.body || "").trim() || r.image).map((r) => (
                        <div key={r.id} className="flex items-start gap-2">
                            {r.is_coach ? (
                                <PersonaAvatar persona={persona} size={24}/>
                            ) : (
                                <ProfileAvatar user={{profile_picture: r.author_profile_picture, first_name: r.author_name}} size={24}/>
                            )}
                            <div className={"min-w-0 flex-1 rounded-2xl px-3 py-2 " +
                                (r.is_coach ? "glass-card border-l-2" : "bg-ink-950/[0.04] dark:bg-white/[0.05]")}
                                 style={r.is_coach ? {borderLeftColor: accent} : undefined}>
                                {/* break-words: pasted URLs / unbreakable strings wrap
                                    instead of overflowing the viewport (page scrolled
                                    sideways on smartphones). */}
                                {(r.is_coach ? stripCharacterCountSuffix(r.body) : (r.body || "")).trim() ? (
                                r.is_coach
                                    ? <CoachBody text={stripCharacterCountSuffix(r.body)}/>
                                    : <p className="text-sm leading-snug break-words dark:text-gray-100">{r.body}</p>
                                ) : null}
                                {r.image && (
                                    <ReplyImage url={r.image}
                                                alt={r.body ? `Coach remix: ${r.is_coach ? stripCharacterCountSuffix(r.body) : r.body}` : "Coach remix"}
                                                elapsed={elapsedSince(r.posted_at, now)}/>
                                )}
                                <p className="text-xs text-muted mt-1">
                                    {r.is_coach ? (persona?.name || "Coach") : (r.author_name || "Participant")} · {timeAgo(r.posted_at)}
                                </p>
                                {r.is_coach && <CoachFeedback id={r.id}/>}
                            </div>
                        </div>
                    ))}

                    {canReply && (
                        <div className="min-w-0 w-full space-y-1">
                            <div className="mb-1 flex flex-wrap gap-2">
                                {SUGGESTIONS.map((hint) => (
                                    <button key={hint} type="button" onClick={() => setText(hint)}
                                            className="min-h-[44px] rounded-full px-3 text-sm font-semibold text-muted"
                                            style={{border: "1px solid var(--hairline)", background: "var(--surface-2)"}}>
                                        {hint}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 min-w-0 w-full">
                                <div className="composer-rim min-w-0 flex-1 rounded-full">
                                <input
                                    type="text"
                                    value={text}
                                    maxLength={500}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                                    placeholder={`Reply to ${persona?.name || "the coach"}…`}
                                    aria-label={`Reply to ${persona?.name || "the coach"}`}
                                    className="min-w-0 w-full min-h-[44px] h-11 rounded-full border-0 bg-white/80 py-2 px-3 text-sm leading-tight text-gray-800 focus:outline-none dark:bg-ink-850 dark:text-gray-200 dark:placeholder-gray-500 sm:px-4"
                                />
                                </div>
                                <button onClick={handleSend} disabled={isLoading || !text.trim()}
                                        aria-label="Send reply"
                                        className="shrink-0 h-11 w-11 min-h-[44px] min-w-[44px] btn-plate transition disabled:opacity-50 disabled:shadow-none flex items-center justify-center">
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
