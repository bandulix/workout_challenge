import React from "react";
import {AlertCircle} from "lucide-react";
import { createAsyncThunk } from '@reduxjs/toolkit';
import {useDispatch} from "react-redux";
import {useTheme} from "./theme";

function throwErrorWithCode(message, errorCode) {
    const error = new Error(message);
    error.code = errorCode;
    error.status = errorCode;
    error.statusText = message;
    error.ok = false;
    throw error;
}


function deepDiff(obj1, obj2) {
    const diff = {};
    const keys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
    keys.forEach(key => {
        const val1 = obj1[key];
        const val2 = obj2[key];

        if (typeof val1 === 'object' && val1 && typeof val2 === 'object' && val2) {
            const nested = deepDiff(val1, val2);
            if (Object.keys(nested).length > 0) diff[key] = nested;
        } else if (val1 !== val2) {
            diff[key] = {from: val1, to: val2};
        }
    });
    return diff;
}

function compareDictLists(oldDict, newDict) {
    const oldMap = Object.fromEntries(oldDict.map(item => [item.id, item]));
    const newMap = Object.fromEntries(newDict.filter(i => i.id).map(item => [item.id, item]));

    const newEntries = newDict.filter(item => !item.id);

    const deletedEntries = oldDict.filter(item => !newMap[item.id]);

    const changedEntries = [];
    for (const id in newMap) {
        if (oldMap[id]) {
            const diff = deepDiff(oldMap[id], newMap[id]);
            if (Object.keys(diff).length > 0) {
                changedEntries.push({id, index: oldMap[id]?.index, changes: diff});
            }
        }
    }

    return {newEntries, deletedEntries, changedEntries};
}


function BoxSection({additionalClasses = '', children}) {
    return (
        <div className={"bg-white dark:bg-ink-850 rounded-3xl shadow-card dark:shadow-card-dark dark:border dark:border-ink-700/60 p-5 sm:p-6 " + additionalClasses}>
            {children}
        </div>
    )
}


export const resetStoreAsync = createAsyncThunk('store/reset', async (_, {dispatch}) => {
    dispatch({type: 'RESET_STORE'});
});

function ErrorBoxSection({errorMsg, additionalClasses = ''}) {
    const dispatch = useDispatch();

    async function handleReload() {
        await dispatch(resetStoreAsync());
        console.log('Store has been reset');
        window.location.reload();
    }

    return (
        <BoxSection additionalClasses={"flex items-center justify-center " + additionalClasses}>
            <div
                className="flex items-start gap-3 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md">
                <AlertCircle className="w-20 h-20 mt-1 text-red-700"/>
                <div>
                    <p className="font-semibold">Oops, that didn't work!</p>
                    <p>Please <a href='' className='text-blue-500 hover:underline' onClick={() => handleReload()}>reset & reload the page (click here)</a>. If the issue remains, <a className='text-blue-500 hover:underline' target='_self' href="/logout">log out (click here)</a> and log back in. If it still persists, contact the administrator.</p>
                    <br/>
                    <p className="font-semibold italic">This error occurred:</p>
                    <p className="bg-red-200 text-sm p-2 rounded font-mono">{errorMsg}</p>
                </div>
            </div>
        </BoxSection>
    )
}

function PageWrapper({additionClasses = '', children}) {
    // pb-24 reserves space at the bottom so content isn't covered by the
    // fixed bottom navigation (bar on mobile, floating dock on desktop).
    // The safe-area-inset accounts for the iPhone home indicator.
    return (
        <div className={"min-h-screen bg-[#f2f4ec] dark:bg-ink-950 dark:text-white p-2 sm:p-6 pb-24 " + additionClasses}>
            {children}
        </div>
    )
}

function useDarkMode() {
  // Resolved class-based theme (light/dark/system) - keeps canvas charts
  // in sync with the user-selected theme rather than only the OS setting.
  const {resolvedTheme} = useTheme();
  return resolvedTheme === 'dark';
}


export {throwErrorWithCode, deepDiff, compareDictLists, PageWrapper, BoxSection, ErrorBoxSection, useDarkMode};