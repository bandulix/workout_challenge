import React, {useEffect, useState} from "react";
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
} from "lucide-react";
import {BeatLoader} from "react-spinners";
import { isMobile } from "react-device-detect";
import TimeField from "./customTimefieldInput";


export const FIELD_INPUT_CLASS =
    "w-full rounded-xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-ink-900/80 py-2.5 px-3 text-gray-800 dark:text-gray-200 leading-tight focus:outline-none focus:border-volt-500";


export function Modal({setShowModal, title = null, landscape = false, isLoading = false, children}) {
    const closeModal = () => {
        document.body.classList.remove('body-no-scroll');
        setShowModal(false);
    }

    useEffect(() => {
        document.body.classList.add('body-no-scroll');
    }, []);

    // Overlay is a flex box, not a scrollport: centering a taller-than-
    // viewport panel with items-center clips the top AND the save button
    // (classic flex overflow) so phone users could not reach Create.
    return (
        <div
            className="modal-background fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4"
            onClick={closeModal}
        >
            <div
                className={"relative flex max-h-[100dvh] w-full flex-col overflow-hidden glass-card animate-pop-in " +
                    ((landscape) ? "max-w-4xl " : "max-w-2xl ") +
                    "sm:max-h-[90vh] sm:rounded-3xl max-sm:min-h-[100dvh] max-sm:rounded-none"}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2 sm:px-8 sm:pt-6">
                    <h2 className="font-display text-sm uppercase tracking-wider">{title}</h2>
                    <button className="text-gray-400 hover:text-gray-600 dark:hover:text-volt-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
                            onClick={closeModal}
                            aria-label="Close"
                    >
                        <X className="h-5 w-5"/>
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:pb-8 space-y-4">
                    {
                        (isLoading) ? (
                                <div className="w-full h-64 flex items-center justify-center">
                                    <BeatLoader color="#d7ff3e"/>
                                </div>
                            ) :
                            children
                    }
                </div>
            </div>
        </div>
    )
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
                              width = "w-full",
                              highlight = false,
                              errorMsg = null,
                              inputMode = null,
                              hint = null,
                          }) {


    let additionalClasses = "";
    if (readOnly) {
        additionalClasses += " text-gray-500 dark:text-gray-500 " + ((highlight) ? "": " bg-gray-100 dark:bg-ink-800 ");
    }
    if (disabled) {
        additionalClasses += " text-gray-500 dark:text-gray-500 cursor-not-allowed " + ((highlight) ? "": " bg-gray-100 dark:bg-ink-800 ");
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
                        <>
                            {/* Dropdown Input Element */}
                            <select
                                className={FIELD_INPUT_CLASS + (highlight ? " bg-volt-400/15 dark:bg-volt-400/10 border-volt-500/50 ": "") + additionalClasses}
                                id={name}
                                name={name}
                                tabIndex={tabIndex}
                                required={required}
                                disabled={disabled}
                                autoFocus={!isMobile && autoFocus}
                                value={(value === null) ? '' : value}
                                onChange={(e) => setValue(e.target.value)}
                            >
                                {(placeholder !== false) && <option value="">{(placeholder) ? placeholder : "Select an option"}</option>}
                                {selectList.map((item, index) => (
                                    <option key={index} value={item.value}>{item.label}</option>
                                ))}
                            </select>
                        </>
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
                                inputMode={inputMode || (type === "number" ? "decimal" : type === "email" ? "email" : undefined)}
                                enterKeyHint={type === "number" ? "next" : type === "email" ? "next" : "done"}
                                value={(value === null) ? '' : value}
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