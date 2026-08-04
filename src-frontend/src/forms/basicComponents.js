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
} from "lucide-react";
import {BeatLoader} from "react-spinners";
import { isMobile } from "react-device-detect";
import TimeField from "./customTimefieldInput";


export function Modal({setShowModal, title = null, landscape = false, isLoading = false, children}) {
    const backgroundClick = (e) => {
        if (e.target.classList.contains('modal-background')) {
            closeModal();
        }
    }

    const closeModal = () => {
        document.body.classList.remove('body-no-scroll');
        setShowModal(false);
    }

    useEffect(() => {
        document.body.classList.add('body-no-scroll');
    }, []);

    return (
        <div
            className="modal-background fixed inset-0 z-50 bg-black/50 backdrop-blur-sm overflow-y-auto sm:p-4"
            onClick={(e) => backgroundClick(e)}
        >
            <div className="modal-background min-h-screen flex items-center justify-center">
                <div
                    className={"relative bg-white dark:bg-ink-850 dark:border dark:border-ink-700/60 rounded-3xl shadow-card-dark p-6 sm:p-8 animate-pop-in " + ((landscape) ? "max-w-4xl" : "max-w-2xl") +
                        " w-full space-y-4 max-sm:w-full max-sm:min-h-screen max-sm:rounded-none max-sm:p-4 max-sm:m-0 max-sm:shadow-none max-sm:border-0 max-sm:pb-[max(2rem,env(safe-area-inset-bottom))]"}
                >
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-display uppercase tracking-wide">{title}</h2>
                        <button className="text-gray-400 hover:text-gray-600 dark:hover:text-volt-300 text-2xl leading-none min-h-[44px] min-w-[44px]"
                                onClick={() => closeModal()}
                        >
                            &times;
                        </button>
                    </div>

                    {
                        (isLoading) ? (
                                <div className="w-full h-64 flex items-center justify-center">
                                    <BeatLoader height={6} width={200} color="rgb(209 213 219)"/>
                                </div>
                            ) :
                            (
                                <>
                                    {children}
                                </>
                            )
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
        additionalClasses += " text-gray-500 dark:text-gray-500 " + ((highlight) ? "": " bg-gray-100 dark:bg-gray-700 ");
    }
    if (disabled) {
        additionalClasses += " text-gray-500 dark:text-gray-500 cursor-not-allowed " + ((highlight) ? "": " bg-gray-100 dark:bg-gray-700 ");
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
                    className="w-full text-gray-700 dark:text-gray-400 text-sm font-bold mb-2 mr-4"
                    onClick={(type === "checkbox") ? (e) => setValue(!value): null}
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
                            input={<input type="text" className={"w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-ink-900 dark:text-gray-300 leading-tight focus:outline-none focus:shadow-outline" + (highlight ? " bg-volt-400/20 dark:bg-volt-400/10 ": "") + additionalClasses} />}
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
                                className={"w-full shadow border rounded py-2 px-3 text-gray-700 dark:bg-ink-850 dark:text-gray-300 leading-tight focus:outline-none focus:shadow-outline" + (highlight ? " bg-volt-400/15 dark:bg-volt-400/10 border border-volt-500/50 ": "") + additionalClasses}
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
                                className={"w-full shadow border rounded py-2 px-3 text-gray-700 dark:text-gray-400 dark:placeholder-gray-600 leading-tight focus:outline-none focus:shadow-outline" + (highlight ? " bg-volt-400/15 dark:bg-volt-400/10 border border-volt-500/50 ": " dark:bg-ink-900 ") + additionalClasses}
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
                <FormInput key={fieldName} {...fieldKwargs} value={values[fieldName]} errorMsg={errors[fieldName]}
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
                <div key={index} className="relative border border-gray-300 rounded-lg p-4 mb-4">
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
            className={"flex items-center gap-2 transition hover:shadow active:scale-[0.97] " + tapTargetClass + " " + (larger ? (label ? " px-5 py-2.5 font-semibold rounded-full " : " px-3 py-3 rounded-2xl ") : (label ? " px-4 py-2 rounded-full " : " p-2 rounded-2xl ")) + (isLoading ? " bg-white hover:bg-white shadow-none border border-gray-200 dark:bg-ink-850 dark:hover:bg-ink-850 " : (highlighted ? " bg-volt-400 text-ink-950 font-bold hover:bg-volt-300 " : " bg-gray-100 hover:bg-gray-200 dark:bg-ink-800 dark:text-gray-200 dark:hover:bg-ink-700 ")) + additionalClasses}
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