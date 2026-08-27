import React, {useEffect, useState} from "react";
import {FIELD_INPUT_CLASS, Modal, SaveButton} from "./basicComponents";
import {useGetSiteSettingsQuery, useUpdateSiteSettingsMutation} from "../utils/reducers/siteSettingsSlice";
import {workoutTypes} from "./workoutForm";
import {confirmAction, notice} from "../utils/dialogs";
import {clearBodyScrollLock} from "../utils/overlay";

// Admin editor for the site-wide per-activity-type point multipliers.
// The map is stored sparsely (only factors != 1.0 are sent/saved); the
// scorer treats missing keys as neutral. Saving re-scores existing
// points rows in the background (see competition.scorer).
export default function SportFactorsForm({setModalState}) {

    const {data: settings, isLoading} = useGetSiteSettingsQuery();
    const [updateSettings, {isLoading: saving}] = useUpdateSiteSettingsMutation();

    const [factors, setFactors] = useState({});
    const [formError, setFormError] = useState('');

    // Prefill from the stored sparse map.
    useEffect(() => {
        if (settings !== undefined) {
            setFactors(settings.points_sport_factors || {});
        }
    }, [settings]);

    function setFactor(sportType, rawValue) {
        setFactors({...factors, [sportType]: rawValue});
    }

    async function handleSubmit() {
        setFormError('');
        // Validate + store sparsely: only valid numbers != 1.0 are kept.
        const sparse = {};
        for (const [sport, raw] of Object.entries(factors)) {
            if (raw === '' || raw === null || raw === undefined) continue;
            const value = parseFloat(raw);
            if (isNaN(value) || value < 0 || value > 100) {
                setFormError(`Invalid factor for ${sport}: "${raw}" (use a number between 0 and 100).`);
                return;
            }
            if (value !== 1.0) {
                sparse[sport] = value;
            }
        }
        try {
            await updateSettings({points_sport_factors: sparse}).unwrap();
            setModalState(false);
            clearBodyScrollLock();
            await notice('Saved. The re-calculation of all competition points runs in the background and might take a few minutes.');
        } catch (err) {
            setFormError('Save failed (' + (err?.status ?? '') + ') - please try again.');
        }
    }

    return (
        <Modal title="Points per Activity Type" landscape={true} setShowModal={setModalState} isLoading={isLoading || saving}>
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                Every activity type’s raw points are multiplied by its factor. <b>1.00 is neutral</b> —
                raise a factor to reward a sport, lower it to dampen it. Applies to all challenges on
                this server and re-scores existing workouts.
            </p>
            <div className="rounded-2xl glass-inset overflow-hidden max-h-[50vh] overflow-y-auto">
                <table className="w-full text-sm">
                    <tbody>
                    {Object.entries(workoutTypes).map(([sport, labels]) => (
                        <tr key={sport} className="border-b border-gray-100 dark:border-ink-700/40 last:border-0">
                            <td className="py-2 pl-3 text-gray-700 dark:text-gray-300">{labels.label}</td>
                            <td className="py-2 pr-3 w-28">
                                <input
                                    type="number"
                                    step="0.05"
                                    min="0"
                                    max="100"
                                    inputMode="decimal"
                                    className={FIELD_INPUT_CLASS + " text-right py-1.5 " +
                                        ((parseFloat(factors[sport] ?? 1) !== 1.0 && factors[sport] !== '' && factors[sport] !== undefined)
                                            ? "bg-volt-400/15 dark:bg-volt-400/10 border-volt-500/50"
                                            : "")}
                                    value={factors[sport] ?? ''}
                                    placeholder="1.00"
                                    onChange={(e) => setFactor(sport, e.target.value)}
                                />
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
            <div className="text-center text-red-500 text-xs italic">{formError}</div>
            <div className="relative flex justify-end items-center">
                <SaveButton onClick={handleSubmit} label="Update" highlighted={true} larger={true}/>
            </div>
        </Modal>
    )
}
