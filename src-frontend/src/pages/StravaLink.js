import {useGetUserByIdQuery, usersApi} from "../utils/reducers/usersSlice";
import React, {useEffect} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {workoutsApi} from "../utils/reducers/workoutsSlice";
import {useGetStravaStateQuery, useLinkStravaMutation} from "../utils/reducers/linkSlice";
import {useDispatch} from "react-redux";
import {ErrorBoxSection, PageWrapper} from "../utils/miscellaneous";
import {SectionLoader} from "../utils/loaders";


export function InitStravaLink() {

    const {
        error: userError,
        isLoading: userIsLoading,
        isSuccess: userIsSuccess
    } = useGetUserByIdQuery('me');

    const baseUrl = `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : ''}/strava/return/`;
    const encodedBaseUrl = encodeURIComponent(baseUrl);

    const STRAVA_CLIENT_ID = window.RUNTIME_CONFIG?.REACT_APP_STRAVA_CLIENT_ID;
    const {data: stateData, isSuccess: stateIsSuccess, isError: stateIsError} = useGetStravaStateQuery();
    const stateToken = stateData?.state || '';
    const isIOS = () => {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    };

    const urlSecondPart = `client_id=${STRAVA_CLIENT_ID}&response_type=code&approval_prompt=force&scope=profile:read_all,activity:read_all&redirect_uri=${encodedBaseUrl}&state=${encodeURIComponent(stateData?.state || '')}`;
    let urlFirstPart = '';

    if (isIOS()) {
        urlFirstPart = 'strava://oauth/mobile/authorize?';
    } else {
        urlFirstPart = 'https://www.strava.com/oauth/mobile/authorize?';
    }

    console.log('Strava linkage url:', baseUrl);

    useEffect(() => {
        // redirect if user valid and logged in and the OAuth state
        // token (CSRF protection) has arrived. Never leave with an
        // empty state - Strava drops it on the way back, which breaks
        // the return URL and surfaces as an opaque "parsing error".
        if (userIsSuccess && stateIsSuccess && stateToken) {
            console.log('Redirect to Strava Auth page');
            window.location.href = (urlFirstPart + urlSecondPart);
        }
    }, [userIsSuccess, stateIsSuccess, stateToken]);

    // loading screen
    if (userIsLoading) return (
        <PageWrapper additionClasses="h-screen flex items-center justify-center">
            <SectionLoader height={"w-2/3 h-80 mb-4"}/>
        </PageWrapper>
    );

    // error catching
    if (userError) return (
        <PageWrapper additionClasses="h-screen flex items-center justify-center">
            <ErrorBoxSection error={userError}/>
        </PageWrapper>
    )

    // state token could not be minted (e.g. expired session)
    if (stateIsError) return (
        <PageWrapper additionClasses="h-screen flex items-center justify-center">
            <div className="text-center">
                <p className="p-2">Could not start the Strava linking (your session may have expired).</p>
                <p className="p-0.5"><a className="text-blue-500 hover:underline" href='/strava/link'>Click here
                    to <b>try again</b></a></p>
            </div>
        </PageWrapper>
    )

    // redirect screen - only offer the manual link once the state token
    // is actually there, never with an empty state parameter
    return (
        <PageWrapper>
            {stateToken ? (
                <>If you are not redirected automatically, follow this <a className="text-blue-500 hover:underline"
                                                                          href={(urlFirstPart + urlSecondPart)}>link to
                Strava</a>.</>
            ) : (
                <SectionLoader height={"w-2/3 h-80 mb-4"} message={"Preparing the Strava link..."}/>
            )}
        </PageWrapper>
    )

}


export function ReturnStravaLink() {

    const navigate = useNavigate();
    const dispatch = useDispatch();

    const [linkStrava, {
        error: linkStravaError,
        isLoading: linkStravaIsLoading,
        isSuccess: linkStravaIsSuccess,
        isError: linkStravaIsError,
    }] = useLinkStravaMutation();

    const {search} = useLocation();
    const query = new URLSearchParams(search);
    const searchCode = query.get('code'); // null if not present
    const searchState = query.get('state'); // null if not present

    const [errorMsg, setErrorMsg] = React.useState(null);

    useEffect(() => {
        if (!(linkStravaIsLoading || linkStravaIsSuccess || linkStravaIsError)) {
            if (searchCode === null) {
                // send user back to set up link page
                console.log('No auth strava code');
                setErrorMsg('No auth code received from Strava. Please try again.');
                navigate('/strava/link');
            } else if (!searchState) {
                // Strava dropped the (or an empty) state param - the
                // backend route can't match it and would 404 as HTML,
                // which the frontend can only show as "parsing error".
                console.error('No state received from Strava');
                setErrorMsg('The Strava session got lost on the way back (missing state). Please try linking again.');
            } else {
                linkStrava({code: searchCode, state: searchState || ''})
                    .unwrap()
                    .then(() => {
                        // successful linkage - redirect user to dashboard
                        console.log('Successfully linked Strava');
                        dispatch(workoutsApi.util.invalidateTags(['Workout']));
                        dispatch(usersApi.util.invalidateTags(['User']));
                        navigate('/dashboard');
                    })
                    .catch((err) => {
                        // send user back to set up link page
                        console.error('Strava linkage error (1):', err);
                        setErrorMsg(`Strava linkage error (${err?.status} / ${err?.data?.message}). Please try again.`);
                    });
            }
        }
    }, [])

    useEffect(() => {
        if (linkStravaError) {
            console.error('Strava linkage error (2):', linkStravaError);
            setErrorMsg(`Strava linkage error - ${linkStravaError?.status} / ${linkStravaError?.data?.message}. Please try again.`);
        }
    }, [linkStravaError])

    // error message
    if (errorMsg) {
        return (
            <PageWrapper additionClasses="h-screen flex items-center justify-center">
                <div className="text-center">
                    <p className="p-2">{errorMsg}</p>
                    <p className="p-0.5"><a className="text-blue-500 hover:underline" href='/strava/link'>Click here
                        to <b>try again linking Strava</b></a></p>
                    <p className="p-0.5"><a className="text-blue-500 hover:underline" href='/dashboard'>Or go back to
                        the <b>Dashboard</b></a></p>
                </div>
            </PageWrapper>
        )
    }

    // loading screen
    return (
        <PageWrapper additionClasses="h-screen flex items-center justify-center">
            <SectionLoader height={"w-2/3 h-80 mb-4"} message={"Hang in there! Importing your workouts from Strava..."} />
        </PageWrapper>
    )

}

