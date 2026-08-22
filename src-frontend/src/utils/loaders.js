import React from "react";
import {BeatLoader} from "react-spinners";
import {BoxSection} from "./miscellaneous";

function SectionLoader({height = "h-64", message = null}) {
    return (
        <BoxSection additionalClasses={"flex flex-col items-center justify-center " + height}>
            {(message !== null) && <><div className="text-gray-800 dark:text-gray-200 mb-3">{message}</div></>}
            <div><BeatLoader color="#d7ff3e" /></div>
        </BoxSection>
    )
}


export {SectionLoader};