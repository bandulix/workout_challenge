import React, {useState} from "react";
import {ChevronDown, ChevronUp, MessageCircle, Send} from "lucide-react";
import {useDispatch} from "react-redux";
import {BeatLoader} from "react-spinners";
import PersonaAvatar from "./PersonaAvatar";
import ProfileAvatar from "./ProfileAvatar";
import {drillInstructorApi, useReplyToDrillMessageMutation} from "../utils/reducers/drillInstructorSlice";
import {timeAgo} from "../utils/time";

// Conversation thread under a top-level coach message: participants of
// the challenge reply, the coach reacts in its persona's voice (async,
// a few seconds later). One level deep on purpose - sub-threads would
// only confuse the chat UI.
//
// Coach bubbles use the persona's avatar/accent, participant bubbles the
// user's profile picture + first name, so it is always clear who spoke.

function CoachThread({message, persona, canReply = true}) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [error, setError] = useState(null);
    const [sendReply, {isLoading}] = useReplyToDrillMessageMutation();
    const dispatch = useDispatch();
    const replies = message.replies || [];

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
        <div className="mt-1">
            <button onClick={() => setOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400 hover:text-volt-600 dark:hover:text-volt-300 transition min-h-[32px]">
                <MessageCircle className="h-3.5 w-3.5"/>
                {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : (canReply ? "Reply" : "")}
                {(canReply || replies.length > 0) && (open ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>)}
            </button>

            {open && (
                <div className="mt-1.5 ml-1.5 pl-3 border-l-2 border-volt-400/40 space-y-3">
                    {replies.map((r) => (
                        <div key={r.id} className="flex items-start gap-2">
                            {r.is_coach ? (
                                <PersonaAvatar persona={persona} size={24}/>
                            ) : (
                                <ProfileAvatar user={{profile_picture: r.author_profile_picture, first_name: r.author_name}} size={24}/>
                            )}
                            <div className="min-w-0">
                                <p className="text-sm leading-snug dark:text-gray-100">{r.body}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                    {r.is_coach ? (persona?.name || "Coach") : (r.author_name || "Participant")} · {timeAgo(r.posted_at)}
                                </p>
                            </div>
                        </div>
                    ))}

                    {canReply && (
                        <>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={text}
                                    maxLength={500}
                                    onChange={(e) => setText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
                                    placeholder={`Reply to ${persona?.name || "the coach"}…`}
                                    aria-label={`Reply to ${persona?.name || "the coach"}`}
                                    className="flex-1 shadow border border-gray-200 dark:border-ink-700/60 rounded-full py-2 px-4 text-sm text-gray-700 dark:bg-ink-900 dark:text-gray-300 dark:placeholder-gray-600 leading-tight focus:outline-none focus:border-volt-500"
                                />
                                <button onClick={handleSend} disabled={isLoading || !text.trim()}
                                        aria-label="Send reply"
                                        className="shrink-0 min-h-[44px] min-w-[44px] rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 transition shadow-glow-volt disabled:opacity-50 disabled:shadow-none flex items-center justify-center">
                                    {isLoading ? <BeatLoader size={5} color="#0a0d06"/> : <Send className="h-4 w-4"/>}
                                </button>
                            </div>
                            {error && <p className="text-xs text-red-500">{error}</p>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export default CoachThread;
