import React, {useEffect, useId, useRef, useState} from "react";
import {
    Plus,
    Trash2,
    Save,
    UsersRound,
    Flag,
    UserRoundPlus,
    RefreshCw,
    Pencil,
    ThumbsUp,
    UserRoundPen,
    X,
    ChevronDown,
} from "lucide-react";
import {BeatLoader} from "react-spinners";
import { isMobile } from "react-device-detect";
import TimeField from "./customTimefieldInput";
import {OverlayPortal, useBodyScrollLock} from "../utils/overlay";


export const FIELD_INPUT_CLASS =
    "w-full rounded-xl border border-ink-950/10 dark:border-white/10 bg-white/55 dark:bg-ink-900/80 py-2.5 px-3 text-gray-800 dark:text-gray-200 leading-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-none focus:outline-none focus:border-volt-500";

export const PANEL_MAX_CLASS = "max-w-2xl";

function optionValue(item) {
    return item == null ? "" : String(item.value);
}

function optionLabel(item) {
    return item?.label ?? String(item?.value ?? "");
}

function placeSelectMenu(anchor) {
    if (!anchor) return null;
    const r = anchor.getBoundingClientRect();
    const gap = 8;
    const maxH = Math.min(22 * 16, Math.round(window.innerHeight * 0.5));
    const width = Math.min(Math.max(r.width, 220), window.innerWidth - 24);
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, r.left));
    const spaceBelow = window.innerHeight - r.bottom - gap;
    const spaceAbove = r.top - gap;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const height = Math.min(maxH, openUp ? spaceAbove : spaceBelow);
    return {
        left,
        width,
        maxHeight: Math.max(120, height),
        top: openUp ? undefined : r.bottom + gap,
        bottom: openUp ? window.innerHeight - r.top + gap : undefined,
    };
}

export function GlassSelect({
    id,
    name,
    value = "",
    onChange,
    options = [],
    placeholder = "Select an option",
    includeBlank = true,
    disabled = false,
    required = false,
    tabIndex,
    autoFocus = false,
    className = "",
    "aria-label": ariaLabel,
}) {
    const uid = useId();
    const listId = `${id || "glass-select"}-${uid}`;
    const btnRef = useRef(null);
    const listRef = useRef(null);
    const typeBuf = useRef("");
    const typeTimer = useRef(null);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState(null);
    const [active, setActive] = useState(-1);

    const rows = includeBlank
        ? [{value: "", label: placeholder || "Select an option"}, ...options]
        : options;
    const current = String(value ?? "");
    const selected = rows.find((row) => optionValue(row) === current);
    const shown = selected ? optionLabel(selected) : (placeholder || "Select an option");

    useEffect(() => {
        if (!open) return undefined;
        const place = () => setPos(placeSelectMenu(btnRef.current));
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const idx = rows.findIndex((row) => optionValue(row) === current);
        setActive(idx < 0 ? 0 : idx);
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                btnRef.current?.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // rows is rebuilt each render; current + open is enough to snap highlight.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, current]);

    useEffect(() => {
        if (!open || !pos) return;
        listRef.current?.focus();
    }, [open, pos]);

    useEffect(() => {
        if (!open || active < 0) return;
        const node = listRef.current?.querySelector(`[data-opt="${active}"]`);
        node?.scrollIntoView({block: "nearest"});
    }, [open, active]);

    function pick(row) {
        onChange?.(optionValue(row) === "" ? "" : row.value);
        setOpen(false);
        btnRef.current?.focus();
    }

    function typeJump(letter) {
        const next = typeBuf.current + letter.toLowerCase();
        typeBuf.current = next;
        clearTimeout(typeTimer.current);
        typeTimer.current = setTimeout(() => { typeBuf.current = ""; }, 700);
        const hit = rows.findIndex((row) => optionLabel(row).toLowerCase().startsWith(next));
        if (hit >= 0) setActive(hit);
    }

    function onTriggerKey(e) {
        if (disabled) return;
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
        } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            if (!open) setOpen(true);
            typeJump(e.key);
        }
    }

    function onListKey(e) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(rows.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
        } else if (e.key === "Home") {
            e.preventDefault();
            setActive(0);
        } else if (e.key === "End") {
            e.preventDefault();
            setActive(rows.length - 1);
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (rows[active]) pick(rows[active]);
        } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            typeJump(e.key);
        }
    }

    return (
        <div className="relative">
            {name != null && <input type="hidden" name={name} value={current} required={required && includeBlank ? undefined : required}/>}
            <button
                ref={btnRef}
                type="button"
                id={id}
                tabIndex={tabIndex}
                autoFocus={autoFocus}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-label={ariaLabel}
                onClick={() => { if (!disabled) setOpen((v) => !v); }}
                onKeyDown={onTriggerKey}
                className={FIELD_INPUT_CLASS + " flex items-center justify-between gap-2 text-left cursor-pointer " +
                    (disabled ? "opacity-60 cursor-not-allowed " : "") + className}
            >
                <span className={"min-w-0 truncate " + (!selected || current === "" ? "text-gray-500 dark:text-gray-400" : "")}>
                    {shown}
                </span>
                <ChevronDown className={"h-4 w-4 shrink-0 text-gray-400 transition " + (open ? "rotate-180 text-volt-400" : "")}/>
            </button>
            {open && pos && (
                <OverlayPortal>
                    <>
                    <div className="fixed inset-0 z-[90]" onPointerDown={() => setOpen(false)} aria-hidden="true"/>
                    <div
                        className="fixed z-[91] animate-pop-in"
                        style={{
                            left: pos.left,
                            width: pos.width,
                            maxHeight: pos.maxHeight,
                            top: pos.top,
                            bottom: pos.bottom,
                        }}
                    >
                        <div
                            ref={listRef}
                            id={listId}
                            role="listbox"
                            tabIndex={-1}
                            aria-activedescendant={`${listId}-${active}`}
                            onKeyDown={onListKey}
                            onPointerDown={(e) => e.stopPropagation()}
                            style={{maxHeight: pos.maxHeight}}
                            className="glass-select-menu glass-sheet overflow-y-auto overscroll-contain rounded-2xl py-1.5"
                        >
                            <span className="glass-sheen rounded-[inherit]" aria-hidden="true"/>
                            {rows.map((row, i) => {
                                const selectedRow = optionValue(row) === current;
                                const activeRow = i === active;
                                return (
                                    <button
                                        key={`${optionValue(row)}-${i}`}
                                        type="button"
                                        role="option"
                                        id={`${listId}-${i}`}
                                        data-opt={i}
                                        aria-selected={selectedRow}
                                        onMouseEnter={() => setActive(i)}
                                        onClick={() => pick(row)}
                                        className={"relative flex w-full min-h-[44px] items-center px-3.5 py-2 text-left text-sm leading-snug transition " +
                                            (selectedRow
                                                ? "bg-volt-400 text-ink-950 font-bold"
                                                : activeRow
                                                    ? "bg-white/55 text-ink-950 dark:bg-white/10 dark:text-white"
                                                    : "text-gray-800 dark:text-gray-200")}
                                    >
                                        {optionLabel(row)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    </>
                </OverlayPortal>
            )}
        </div>
    );
}

const SHEET_BACKDROP =
    "modal-background fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm " +
    "px-3 sm:px-4 " +
    "pt-[max(0.85rem,calc(var(--safe-top)+0.7rem))] " +
    "pb-[max(0.85rem,calc(var(--safe-bottom)+0.7rem))]";
const SHEET_PANEL =
    "relative flex max-h-full w-full flex-col overflow-hidden glass-sheet rounded-[1.75rem] animate-pop-in " +
    PANEL_MAX_CLASS;


export function OverlaySheet({title = null, onClose, children, isLoading = false, zClass = "z-50", labelledBy}) {
    useBodyScrollLock();
    return (
        <OverlayPortal>
            <div className={SHEET_BACKDROP + " " + zClass} onClick={onClose}
                 role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
                <div className={SHEET_PANEL} onClick={(e) => e.stopPropagation()}>
                    <span className="glass-sheen rounded-[inherit]" aria-hidden="true"/>
                    <div className="relative flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2 sm:px-8 sm:pt-5">
                        <h2 id={labelledBy} className="font-display text-sm uppercase tracking-wider">{title}</h2>
                        <button type="button"
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-volt-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
                                onClick={onClose}
                                aria-label="Close">
                            <X className="h-5 w-5"/>
                        </button>
                    </div>
                    <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-8 sm:pb-8 space-y-4">
                        {isLoading ? (
                            <div className="w-full h-64 flex items-center justify-center">
                                <BeatLoader color="#d7ff3e"/>
                            </div>
                        ) : children}
                    </div>
                </div>
            </div>
        </OverlayPortal>
    );
}


export function Modal({setShowModal, title = null, landscape = false, isLoading = false, children}) {
    return (
        <OverlaySheet title={title} onClose={() => setShowModal(false)} isLoading={isLoading}>
            {children}
        </OverlaySheet>
    );
}


// DecimalField values arrive as "130.00". A type=number input with the
// default step of 1 treats that as invalid ("Please enter a valid value");
// coercing to a Number drops trailing zeros so 130.00 displays as 130.
function numberFieldValue(value) {
    if (value === null || value === undefined || value === "") return "";
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
}


export function FormInput({
                              name,
                              value = "",
                              setValue,
                              selectList = [],
                              suggestions = [],
                              label = null,
                              type = "text",
                              placeholder = null,
                              required = false,
                              readOnly = false,
                              disabled = false,
                              tabIndex = null,
                              autoFocus = false,
                              autoComplete = "off",
                              pattern = null,
                              step = null,
                              width = "w-full",
                              highlight = false,
                              errorMsg = null,
                              inputMode = null,
                              hint = null,
                          }) {


    let additionalClasses = "";
    if (readOnly) {
        additionalClasses += " text-gray-500 dark:text-gray-500 " + ((highlight) ? "": " bg-ink-950/[0.05] dark:bg-ink-800 ");
    }
    if (disabled) {
        additionalClasses += " text-gray-500 dark:text-gray-500 cursor-not-allowed " + ((highlight) ? "": " bg-ink-950/[0.05] dark:bg-ink-800 ");
    }

    return (
        <div className={"px-4 " + width}>
            <fieldset>
                {/* Checkbox Input */}
                {
                    (type === "checkbox") ? (
                        <input
                            type="checkbox"
                            className="mr-2 leading-tight"
                            id={name}
                            name={name}
                            tabIndex={tabIndex}
                            readOnly={readOnly}
                            disabled={disabled}
                            autoFocus={!isMobile && autoFocus}
                            checked={value}
                            onChange={(e) => setValue(!value)}
                        />
                    ) : null
                }

                {/* Input Label */}
                {(label) ? <label
                    htmlFor={name}
                    className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4"
                >{label}{(required) ? "*" : null}{(errorMsg) ?
                    <span className="text-red-600 font-normal italic"> ({errorMsg})</span> : null}</label> : null}

                {/* Input Element */}
                {
                    (type === "checkbox") ? (
                        <> {/* Checkbox Input Element has to go before the label */} </>
                    ) :
                    ((type === "time-cursor") || (!isMobile && type === "duration")) ? (
                        <TimeField
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            input={<input type="text" className={FIELD_INPUT_CLASS + (highlight ? " bg-volt-400/20 dark:bg-volt-400/10 ": "") + additionalClasses} />}
                            showSeconds={true}
                        />
                    ) :
                    (type === "radio") ? (
                        <>
                            {/* Radio Select Input Element */}
                            {selectList.map((item, index) => (
                                <label key={index} className="inline-flex items-center mr-4 text-gray-700 text-sm">
                                    <input type="radio" className="form-radio text-gray-700"
                                           name={name}
                                           tabIndex={tabIndex}
                                           disabled={disabled}
                                           autoFocus={!isMobile && autoFocus}
                                           checked={(item.value === value) ? true : null}
                                           onChange={(e) => setValue(e.target.value)}
                                           value={item.value}
                                    />
                                    <span className="ml-2">{item.label}</span>
                                </label>
                            ))}
                        </>
                    ) :
                    (type === "select") ? (
                        <GlassSelect
                            id={name}
                            name={name}
                            value={(value === null || value === undefined) ? "" : value}
                            onChange={setValue}
                            options={selectList}
                            placeholder={placeholder || "Select an option"}
                            includeBlank={placeholder !== false}
                            required={required}
                            disabled={disabled || readOnly}
                            tabIndex={tabIndex}
                            autoFocus={!isMobile && autoFocus}
                            className={(highlight ? " bg-volt-400/15 dark:bg-volt-400/10 border-volt-500/50 " : "") + additionalClasses}
                        />
                    ) :
                    (
                        <>
                            {/* All Other Input Elements */}
                            <input
                                className={FIELD_INPUT_CLASS + (highlight ? " bg-volt-400/15 dark:bg-volt-400/10 border-volt-500/50 ": "") + additionalClasses}
                                id={name}
                                name={name}
                                type={(type === "duration") ? "time" : type}
                                placeholder={placeholder}
                                tabIndex={tabIndex}
                                required={required}
                                readOnly={readOnly}
                                disabled={disabled}
                                autoFocus={!isMobile && autoFocus}
                                autoComplete={autoComplete}
                                pattern={pattern}
                                step={step ?? (type === "number" ? "any" : undefined)}
                                inputMode={inputMode || (type === "number" ? "decimal" : type === "email" ? "email" : undefined)}
                                enterKeyHint={type === "number" ? "next" : type === "email" ? "next" : "done"}
                                value={type === "number" ? numberFieldValue(value) : ((value === null) ? '' : value)}
                                list={name + "-suggestions"}
                                onChange={(e) => setValue(e.target.value)}
                            />
                        </>
                    )
                }

                {/* Input User Suggestions */}
                {
                    (suggestions.length > 0) ? (
                        <datalist id={name + "-suggestions"}>
                            {suggestions.map((item, index) => (
                                <option key={index} value={item}/>
                            ))}
                        </datalist>
                    ) : null
                }

                {/* Optional helper text rendered below the input */}
                {hint && type !== "checkbox" ? (
                    <p className="text-xs text-gray-500 mt-1">{hint}</p>
                ) : null}

            </fieldset>
        </div>
    )
}


export function SingleForm({fields, values, setValues, errors = {}}) {


    return (
        <div className="flex flex-wrap">
            {Object.entries(fields).map(([fieldName, fieldKwargs]) => (
                <FormInput key={fieldName} name={fieldName} {...fieldKwargs} value={values[fieldName]} errorMsg={errors[fieldName]}
                           setValue={(value) => setValues({...values, [fieldName]: value})}/>
            ))}
        </div>
    )
}


export function MultiForm({fields, values, setValues, errors = {}}) {

    //const [values, setValues] = useState([]);

    const addRow = () => {
        const initialValues = Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [key, value.value])
        );
        setValues([...values, {...initialValues}]);
    };

    const deleteRow = (index) => {
        const updated = values.filter((_, i) => i !== index);
        setValues(updated);
    };

    const handleChange = (index, field, value) => {
        const updated = [...values];
        updated[index][field] = value;
        setValues(updated);
    };

    useEffect(() => {
        if (values?.length === 0) {
            //addRow();
        }
    })

    return (
        <div>
            {values?.map((value_row, index) => (
                <div key={index} className="relative border border-gray-200/70 dark:border-ink-700/60 rounded-2xl p-4 mb-4">
                    <button className="absolute top-2 right-2 text-gray-500 hover:text-red-500"
                            onClick={() => deleteRow(index)}
                    >
                        <Trash2 className="h-5 w-5"/>
                    </button>
                    <div className="flex flex-wrap">
                        {Object.entries(fields).map(([fieldName, fieldKwargs]) => (
                            <FormInput key={fieldName} {...fieldKwargs} value={value_row[fieldName]}
                                       errorMsg={errors?.[index]?.[fieldName]}
                                       setValue={(value) => handleChange(index, fieldName, value)}/>
                        ))}
                    </div>
                </div>
            ))}
            <div className="relative flex justify-center items-center">
                <AddButton additionalClasses=" hover:text-green-800 " onClick={addRow} highlighted={false} larger={false}/>
            </div>
        </div>
    )
}


function GenericButton({onClick, icon, label, highlighted, larger, IconObject, isLoading, additionalClasses}) {

    const [dots, setDots] = useState("");

    useEffect(() => {
        if (!isLoading) {
            setDots("");
            return;
        }

        const interval = setInterval(() => {
            setDots(prev => (prev.length < 3 ? prev + "." : ""));
        }, 300);

        return () => clearInterval(interval);
    }, [isLoading]);

    // Icon-only buttons get a min 44x44 tap target on touch devices.
    const tapTargetClass = !label ? "min-h-[44px] min-w-[44px]" : "";

    return (
        <button
            type="button"
            className={"flex items-center gap-2 transition active:scale-[0.97] " + tapTargetClass + " " + (larger ? (label ? " px-5 py-2.5 font-semibold rounded-full " : " px-3 py-3 rounded-2xl ") : (label ? " px-4 py-2 rounded-full " : " p-2 rounded-2xl ")) + (isLoading ? " btn-glass shadow-none " : (highlighted ? " bg-volt-400 text-ink-950 font-bold hover:bg-volt-300 shadow-glow-volt " : " btn-glass ")) + additionalClasses}
            onClick={onClick}
            disabled={isLoading}
        >
            {icon ? <IconObject className={(larger ? "h-4 w-4" : "h-3 w-3")}/> : null}
            {label ? <span className="text-sm">{label}{isLoading ? dots : null}</span> : null}
        </button>
    )
}


export function SaveButton({
                               onClick,
                               icon = true,
                               label = "Save",
                               highlighted = false,
                               larger = false,
                               isLoading = false,
                               additionalClasses = "",
                           }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={Save} isLoading={isLoading} additionalClasses={additionalClasses}/>
}


export function DeleteButton({
                                 onClick,
                                 icon = true,
                                 label = "Delete",
                                 highlighted = false,
                                 larger = false,
                                 isLoading = false,
                                 additionalClasses = "",
                             }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={Trash2} isLoading={isLoading}
                          additionalClasses={" hover:text-red-800 " + additionalClasses}/>
}

export function AddButton({
                              onClick,
                              icon = true,
                              label = "Add",
                              highlighted = false,
                              larger = false,
                              isLoading = false,
                              additionalClasses = "",
                          }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={Plus} isLoading={isLoading} additionalClasses={additionalClasses}/>
}

export function EditButton({
                               onClick,
                               icon = true,
                               label = "Edit",
                               highlighted = false,
                               larger = false,
                               isLoading = false,
                               additionalClasses = "",
                           }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={Pencil} isLoading={isLoading} additionalClasses={additionalClasses}/>
}

export function ChangeOwnerButton({
                                      onClick,
                                      icon = true,
                                      label = "Transfer Ownership",
                                      highlighted = false,
                                      larger = false,
                                      isLoading = false,
                                      additionalClasses = "",
                                  }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={UserRoundPen} isLoading={isLoading} additionalClasses={additionalClasses}/>
}

export function ChangeTeamButton({
                                     onClick,
                                     icon = true,
                                     label = "Change Team",
                                     highlighted = false,
                                     larger = false,
                                     isLoading = false,
                                     additionalClasses = "",
                                 }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={UsersRound} isLoading={isLoading} additionalClasses={additionalClasses}/>
}

export function JoinButton({
                               onClick,
                               icon = true,
                               label = "Join",
                               highlighted = false,
                               larger = false,
                               isLoading = false,
                               additionalClasses = "",
                           }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={UserRoundPlus} isLoading={isLoading} additionalClasses={additionalClasses}/>
}



export function ModifyGoalsButton({
                                      onClick,
                                      icon = true,
                                      label = "Modify Goals",
                                      highlighted = false,
                                      larger = false,
                                      isLoading = false,
                                      additionalClasses = "",
                                  }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={Flag} isLoading={isLoading} additionalClasses={additionalClasses}/>
}




export function SyncStravaButton({
                                   onClick,
                                   icon = true,
                                   label = "Re-Sync with Strava",
                                   highlighted = false,
                                   larger = false,
                                   isLoading = false,
                                   additionalClasses = "",
                               }) {
    return <GenericButton onClick={onClick} icon={icon} label={label} highlighted={highlighted} larger={larger}
                          IconObject={RefreshCw} isLoading={isLoading} additionalClasses={additionalClasses}/>
}



export function StravaButton({onClick, additionalClasses = "", label = "Strava"}) {
    return (
        <button
            className={"flex items-center gap-1 text-orange-500 border border-strava bg-white dark:bg-ink-900 hover:bg-strava hover:text-white hover:shadow text-sm font-medium rounded-md transition p-0 " + additionalClasses}
            onClick={onClick}>
            <img src="/strava_logo.png" alt="Strava" className="w-7 h-7 rounded-tl-sm rounded-bl-sm"/>
            <span className={"pl-1 pr-2 py-1 " + ((label.includes("Like") || label.includes("Follow")) ? "max-lg:hidden" : "")}>{label}</span>
            {
                (label.includes("Like") || label.includes("Follow")) ? (
                    <span className="max-sm:hidden lg:hidden pl-1 pr-2 py-1">
                    {
                        (label.includes("Like")) ? (
                            <ThumbsUp className="h-4 w-4"/>
                        ) : (
                            <UserRoundPlus className="h-4 w-4"/>
                        )
                    }
                </span>
                ) : null
            }
        </button>
    )
}