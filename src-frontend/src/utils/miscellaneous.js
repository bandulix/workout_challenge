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
        <div className={"bg-white dark:bg-ink-850 rounded-3xl shadow-card dark:shadow-card-dark border border-gray-200/70 dark:border-ink-700/60 p-5 sm:p-6 " + additionalClasses}>
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
        window.location.reload();
    }

    return (
        <BoxSection additionalClasses={"flex items-center justify-center " + additionalClasses}>
            <div className="flex flex-col items-center text-center gap-3 max-w-md px-2 py-2">
                <AlertCircle className="w-12 h-12 text-red-500"/>
                <p className="font-display text-lg uppercase tracking-wide">That didn't work</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Reload usually fixes it. If it keeps happening, log out and back in.
                </p>
                <button type="button" onClick={handleReload}
                        className="px-5 py-2.5 rounded-full bg-volt-400 text-ink-950 text-sm font-bold uppercase tracking-wide hover:bg-volt-300 transition shadow-glow-volt">
                    Reset & reload
                </button>
                <a href="/logout" className="text-sm font-semibold text-volt-700 dark:text-volt-300 hover:underline">Log out</a>
                {errorMsg && <p className="text-xs text-gray-400 font-mono break-all">{errorMsg}</p>}
            </div>
        </BoxSection>
    )
}

// Top-level error boundary: without one, any render-time exception (e.g.
// unexpected API data) unmounts the entire React tree and leaves the user
// staring at a white screen with no way out. The fallback offers a reload
// button so the user can recover directly - no need to know how to kill
// and restart the PWA.
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {hasError: false};
    }

    static getDerivedStateFromError() {
        return {hasError: true};
    }

    componentDidCatch(error, info) {
        console.error('Unhandled UI error caught by the error boundary:', error, info);
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="min-h-screen bg-[#f2f4ec] dark:bg-ink-950 flex items-center justify-center p-6">
                <div className="bg-white dark:bg-ink-850 rounded-3xl shadow-card dark:shadow-card-dark dark:border dark:border-ink-700/60 p-8 max-w-md w-full text-center space-y-4">
                    <AlertCircle className="w-12 h-12 mx-auto text-red-500"/>
                    <p className="font-display text-lg uppercase tracking-wide dark:text-white">Something went wrong</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        The app hit an unexpected error. Reloading usually fixes it.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="w-full px-5 py-3 rounded-full bg-volt-400 text-ink-950 font-bold uppercase tracking-wide text-sm hover:bg-volt-300 transition shadow-glow-volt">
                        Reload the app
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        If the problem keeps coming back, <a href="/logout" className="text-volt-700 dark:text-volt-300 hover:underline">log out</a> and
                        log back in. If it still persists, contact the administrator.
                    </p>
                </div>
            </div>
        );
    }
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


export {throwErrorWithCode, deepDiff, compareDictLists, PageWrapper, BoxSection, ErrorBoxSection, ErrorBoundary, useDarkMode};