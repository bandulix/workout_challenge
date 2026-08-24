import React, {useEffect, useState} from "react";
import {
    useGetSiteSettingsQuery,
    useUpdateSiteSettingsMutation,
} from "../utils/reducers/siteSettingsSlice";
import {useGetPushStatusQuery, useSubscribePushMutation, useUnsubscribePushMutation} from "../utils/reducers/pushSlice";
import {subscribeToPush, unsubscribeFromPush} from "../index";
import {FIELD_INPUT_CLASS, Modal, SaveButton} from "./basicComponents";


function Field({label, error, hint, children}) {
    return (
        <div className="px-4 w-full">
            <label className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2">
                {label}
                {error && <span className="text-red-600 font-normal italic"> ({error})</span>}
            </label>
            {children}
            {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
        </div>
    );
}

function Section({title, description, children}) {
    return (
        <section className="rounded-2xl glass-inset p-4 space-y-3">
            <div>
                <h3 className="font-display text-xs uppercase tracking-[0.16em]">{title}</h3>
                {description && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
                )}
            </div>
            <div className="flex flex-wrap -mx-2">{children}</div>
        </section>
    );
}

function PushSubscribeButton({status, onSubscribed}) {
    const [subscribePush] = useSubscribePushMutation();
    const [unsubscribePush] = useUnsubscribePushMutation();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function handleSubscribe() {
        setBusy(true);
        setError("");
        try {
            const subscription = await subscribeToPush();
            const json = subscription.toJSON();
            await subscribePush({
                endpoint: json.endpoint,
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
                user_agent: navigator.userAgent || "",
            }).unwrap();
            onSubscribed();
        } catch (err) {
            console.error("Push subscribe failed", err);
            setError(err?.message || JSON.stringify(err));
        } finally {
            setBusy(false);
        }
    }

    async function handleUnsubscribe() {
        setBusy(true);
        setError("");
        try {
            const subscription = await unsubscribeFromPush();
            if (subscription) {
                await unsubscribePush({endpoint: subscription.endpoint}).unwrap();
            }
            onSubscribed();
        } catch (err) {
            console.error("Push unsubscribe failed", err);
            setError(err?.message || JSON.stringify(err));
        } finally {
            setBusy(false);
        }
    }

    if (!status) {
        return (
            <div className="px-4 w-full text-sm text-gray-500">
                Browser push notifications aren't supported here (you may need to install the app to your home screen first).
            </div>
        );
    }

    return (
        <div className="px-4 w-full">
            {status.subscribed ? (
                <button onClick={handleUnsubscribe} disabled={busy}
                        className="px-4 py-2 rounded-full btn-glass text-sm font-semibold min-h-[44px] transition">
                    {busy ? "Working..." : "Disable browser notifications"}
                </button>
            ) : (
                <button onClick={handleSubscribe} disabled={busy}
                        className="px-4 py-2 rounded-full bg-volt-400 text-ink-950 hover:bg-volt-300 text-sm font-bold min-h-[44px] transition">
                    {busy ? "Working..." : "Enable browser notifications"}
                </button>
            )}
            {status.subscribed && (
                <p className="text-xs text-gray-500 mt-2">
                    Active on {status.count} device{status.count === 1 ? "" : "s"}.
                </p>
            )}
            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
    );
}


export default function SiteSettingsForm({setModalState}) {
    const {data: settings, isLoading, refetch} = useGetSiteSettingsQuery();
    const [updateSettings, {isLoading: saving}] = useUpdateSiteSettingsMutation();
    const {data: pushStatus, refetch: refetchPushStatus} = useGetPushStatusQuery();
    const pushSupported = typeof window !== "undefined"
        && "serviceWorker" in navigator
        && "PushManager" in window
        && (typeof window.Notification !== "undefined");

    const [values, setValues] = useState({});
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState("");

    useEffect(() => {
        if (settings) {
            setValues({
                // Secrets - never repopulate the real value.
                llm_api_key: "",
                strava_client_secret: "",
                email_host_password: "",
                health_developer_password: "",
                // Plain fields. llm_provider stays "" for "deployment
                // default" - coercing it to "custom" would shadow the
                // .env LLM_PROVIDER on every save.
                llm_provider: settings.llm_provider || "",
                llm_base_url: settings.llm_base_url || "",
                llm_model: settings.llm_model || "",
                llm_email_model: settings.llm_email_model || "",
                strava_client_id: settings.strava_client_id ?? "",
                strava_limit_15min: settings.strava_limit_15min ?? "",
                strava_limit_day: settings.strava_limit_day ?? "",
                health_base_url: settings.health_base_url || "",
                health_public_url: settings.health_public_url || "",
                health_developer_email: settings.health_developer_email || "",
                email_host: settings.email_host || "",
                email_port: settings.email_port ?? "",
                email_host_user: settings.email_host_user || "",
                email_use_tls: !!settings.email_use_tls,
                email_use_ssl: !!settings.email_use_ssl,
                email_from: settings.email_from || "",
                email_reply_to: settings.email_reply_to || "",
            });
        }
    }, [settings]);

    const LLM_PROVIDER_PRESETS = {
        custom: {base_url: "", model: ""},
        MiniMax: {base_url: "https://api.minimax.io/v1", model: "MiniMax-M3"},
        openai: {base_url: "", model: "gpt-4o-mini"},
    };

    function handleProviderChange(newProvider) {
        const preset = LLM_PROVIDER_PRESETS[newProvider] || {};
        setValues((prev) => ({
            ...prev,
            llm_provider: newProvider,
            // Only auto-fill when the field is empty - don't clobber an
            // explicit override the admin already typed.
            llm_base_url: prev.llm_base_url || preset.base_url || "",
            llm_model: prev.llm_model || preset.model || "",
        }));
    }

    function setField(name, value) {
        setValues((prev) => ({...prev, [name]: value}));
    }

    async function handleSubmit() {
        setFieldErrors({});
        setFormError("");
        const payload = {...values};

        // Empty secrets are omitted so the server keeps the existing value.
        for (const secret of ["llm_api_key", "strava_client_secret", "email_host_password", "health_developer_password"]) {
            if (!payload[secret]) delete payload[secret];
        }
        // Coerce empty numeric strings to null.
        for (const numField of ["strava_client_id", "strava_limit_15min", "strava_limit_day", "email_port"]) {
            if (payload[numField] === "" || payload[numField] === null || payload[numField] === undefined) {
                payload[numField] = null;
            } else {
                const n = Number(payload[numField]);
                payload[numField] = Number.isFinite(n) ? n : null;
            }
        }
        try {
            await updateSettings(payload).unwrap();
            await refetch();
            setModalState(false);
            document.body.classList.remove("body-no-scroll");
        } catch (err) {
            console.error("Site settings save failed", err);
            setFieldErrors(err?.data || {});
            setFormError(JSON.stringify(err?.data || err?.message));
        }
    }

    const updatedAt = settings?.updated_at
        ? new Date(settings.updated_at).toLocaleString()
        : "—";

    return (
        <Modal title="Site Settings" landscape={true} setShowModal={setModalState} isLoading={isLoading || saving}>
            <p className="text-xs text-gray-500 dark:text-gray-400 px-1">
                Each block is independent. Leave a field blank to keep the matching
                environment variable from <code>docker-compose.yml</code>. Last updated {updatedAt}.
            </p>

            <Section title="LLM / AI Provider"
                     description="Used by the AI Drill Instructor and the weekly email AI fact.">
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Provider Preset" error={fieldErrors.llm_provider}
                           hint="Picking MiniMax auto-fills the base URL and model below. You can still override either. 'Deployment default' follows the .env values (LLM_PROVIDER/LLM_BASE_URL/LLM_MODEL) - a docker recreate applies them.">
                        <select
                            className={FIELD_INPUT_CLASS}
                            value={values.llm_provider ?? ""}
                            onChange={(e) => handleProviderChange(e.target.value)}>
                            <option value="">Deployment default (.env)</option>
                            <option value="custom">Custom (OpenAI-compatible)</option>
                            <option value="MiniMax">MiniMax</option>
                            <option value="openai">OpenAI</option>
                        </select>
                    </Field>
                </div>
                <Field label="API Key" error={fieldErrors.llm_api_key}
                       hint={<>Currently stored: <code>{settings?.llm_api_key_masked || "(not set)"}</code></>}>
                    <input type="password" autoComplete="off"
                           className={FIELD_INPUT_CLASS}
                           value={values.llm_api_key || ""}
                           onChange={(e) => setField("llm_api_key", e.target.value)}
                           placeholder="leave blank to keep current"/>
                </Field>
                <Field label="Base URL" error={fieldErrors.llm_base_url}>
                    <input type="text"
                           className={FIELD_INPUT_CLASS}
                           value={values.llm_base_url || ""}
                           onChange={(e) => setField("llm_base_url", e.target.value)}
                           placeholder="https://openrouter.ai/api/v1"/>
                </Field>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Drill Instructor Model" error={fieldErrors.llm_model}
                           hint="Default: gpt-4o-mini">
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.llm_model || ""}
                               onChange={(e) => setField("llm_model", e.target.value)}
                               placeholder="gpt-4o-mini"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Weekly Email Model" error={fieldErrors.llm_email_model}
                           hint="Default: gpt-4o">
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.llm_email_model || ""}
                               onChange={(e) => setField("llm_email_model", e.target.value)}
                               placeholder="gpt-4o"/>
                    </Field>
                </div>
            </Section>

            <Section title="Strava"
                     description="OAuth credentials and rate limits for syncing activities.">
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Client ID" error={fieldErrors.strava_client_id}>
                        <input type="number"
                               className={FIELD_INPUT_CLASS}
                               value={values.strava_client_id ?? ""}
                               onChange={(e) => setField("strava_client_id", e.target.value)}
                               placeholder="123456"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Client Secret" error={fieldErrors.strava_client_secret}
                           hint={<>Currently stored: <code>{settings?.strava_client_secret_masked || "(not set)"}</code></>}>
                        <input type="password" autoComplete="off"
                               className={FIELD_INPUT_CLASS}
                               value={values.strava_client_secret || ""}
                               onChange={(e) => setField("strava_client_secret", e.target.value)}
                               placeholder="leave blank to keep current"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Rate Limit / 15min" error={fieldErrors.strava_limit_15min}
                           hint="Default 100 (300 with Strava developer program).">
                        <input type="number"
                               className={FIELD_INPUT_CLASS}
                               value={values.strava_limit_15min ?? ""}
                               onChange={(e) => setField("strava_limit_15min", e.target.value)}
                               placeholder="100"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Rate Limit / Day" error={fieldErrors.strava_limit_day}
                           hint="Default 1000 (3000 with Strava developer program).">
                        <input type="number"
                               className={FIELD_INPUT_CLASS}
                               value={values.strava_limit_day ?? ""}
                               onChange={(e) => setField("strava_limit_day", e.target.value)}
                               placeholder="1000"/>
                    </Field>
                </div>
            </Section>

            <Section title="Health (Open Wearables)"
                     description="Apple Health / Google Health Connect import via a self-hosted Open Wearables instance. Both fields are required to enable the connector; users then see the Health link section in their personal settings.">
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Base URL" error={fieldErrors.health_base_url}
                           hint="The Open Wearables instance, e.g. https://health.your-domain.com">
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.health_base_url || ""}
                               onChange={(e) => setField("health_base_url", e.target.value)}
                               placeholder="https://health.your-domain.com"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Public URL (phones)" error={fieldErrors.health_public_url}
                           hint="Shown in the connection code - the address athletes' phones must reach. Leave blank to use the Base URL.">
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.health_public_url || ""}
                               onChange={(e) => setField("health_public_url", e.target.value)}
                               placeholder="https://health.your-domain.com"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Developer Email" error={fieldErrors.health_developer_email}
                           hint="The Open Wearables developer login the connector uses (its JWT works on all OW endpoints).">
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.health_developer_email || ""}
                               onChange={(e) => setField("health_developer_email", e.target.value)}
                               placeholder="admin@example.com"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Developer Password" error={fieldErrors.health_developer_password}
                           hint={<>Currently stored: <code>{settings?.health_developer_password_masked || "(not set)"}</code></>}>
                        <input type="password" autoComplete="off"
                               className={FIELD_INPUT_CLASS}
                               value={values.health_developer_password || ""}
                               onChange={(e) => setField("health_developer_password", e.target.value)}
                               placeholder="leave blank to keep current"/>
                    </Field>
                </div>
            </Section>

<Section title="SMTP / Outbound Email"
                     description="Used for all automated emails (welcome, leaderboard, weekly, password reset).">
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Host" error={fieldErrors.email_host}>
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.email_host || ""}
                               onChange={(e) => setField("email_host", e.target.value)}
                               placeholder="smtp.gmail.com"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Port" error={fieldErrors.email_port}>
                        <input type="number"
                               className={FIELD_INPUT_CLASS}
                               value={values.email_port ?? ""}
                               onChange={(e) => setField("email_port", e.target.value)}
                               placeholder="465"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Username" error={fieldErrors.email_host_user}>
                        <input type="text"
                               className={FIELD_INPUT_CLASS}
                               value={values.email_host_user || ""}
                               onChange={(e) => setField("email_host_user", e.target.value)}
                               placeholder="competition@yourdomain.com"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Password" error={fieldErrors.email_host_password}
                           hint={<>Currently stored: <code>{settings?.email_host_password_masked || "(not set)"}</code></>}>
                        <input type="password" autoComplete="off"
                               className={FIELD_INPUT_CLASS}
                               value={values.email_host_password || ""}
                               onChange={(e) => setField("email_host_password", e.target.value)}
                               placeholder="leave blank to keep current"/>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Use TLS">
                        <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                            <input type="checkbox"
                                   className="mr-2 leading-tight"
                                   checked={!!values.email_use_tls}
                                   onChange={(e) => setField("email_use_tls", e.target.checked)}/>
                            Enable STARTTLS (typically port 587)
                        </label>
                    </Field>
                </div>
                <div className="px-4 w-full sm:w-1/2">
                    <Field label="Use SSL">
                        <label className="inline-flex items-center text-gray-700 dark:text-gray-300 text-sm">
                            <input type="checkbox"
                                   className="mr-2 leading-tight"
                                   checked={!!values.email_use_ssl}
                                   onChange={(e) => setField("email_use_ssl", e.target.checked)}/>
                            Enable SSL/TLS (typically port 465)
                        </label>
                    </Field>
                </div>
                <Field label="From Address" error={fieldErrors.email_from}>
                    <input type="email"
                           className={FIELD_INPUT_CLASS}
                           value={values.email_from || ""}
                           onChange={(e) => setField("email_from", e.target.value)}
                           placeholder="competition@yourdomain.com"/>
                </Field>
                <Field label="Reply-To" error={fieldErrors.email_reply_to}
                       hint="Comma-separated list of addresses.">
                    <input type="text"
                           className={FIELD_INPUT_CLASS}
                           value={values.email_reply_to || ""}
                           onChange={(e) => setField("email_reply_to", e.target.value)}
                           placeholder="support@yourdomain.com, admin@yourdomain.com"/>
                </Field>
            </Section>

            <Section title="Browser Push Notifications"
                     description="Get a system notification on this device when the AI Drill Instructor comments on an activity in a competition where you've enabled push. (The Drill Instructor has its own per-competition push toggle.)">
                <PushSubscribeButton
                    status={pushSupported ? pushStatus : null}
                    onSubscribed={() => refetchPushStatus()}
                />
            </Section>

            <div className="text-center text-red-500 text-xs italic mt-3">{formError}</div>

            <div className="relative flex justify-end items-center mt-4">
                <SaveButton onClick={handleSubmit} label="Save" highlighted={true} larger={true}/>
            </div>
        </Modal>
    );
}