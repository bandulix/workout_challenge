import ContentLoader from "react-content-loader";
import React from "react";
import {BeatLoader} from "react-spinners";
import {BoxSection} from "./miscellaneous";

function TextLoader({lines = [{width: "410", height: "6"}, {width: "380", height: "6"}, {width: "178", height: "6"}]}) {
    let width = 0;
    let height = 0;
    let lineProps = []

    for (const line of lines) {
        lineProps.push({width: line.width, height: line.height, x: 0, y: height})
        width = Math.max(width, parseInt(line.width) + 10);
        height += (parseInt(line.height) + 10);
    }

    return (
        <ContentLoader
            speed={2}
            width={width}
            height={height}
            viewBox={"0 0 " + width + " " + height}
            backgroundColor="#f3f3f3"
            foregroundColor="#ecebeb"
        >
            {lineProps.map((line, index) => (
                <rect key={"line" + index} x={line.x} y={line.y} rx="3" ry="3" width={line.width} height={line.height}/>
            ))}
        </ContentLoader>
    )
}

function TableLoader({cols = [{width: "100"}, {width: "100"}, {width: "200"}, {width: "150"}, {width: "50"}]}, rows = 5) {
    let width = 0;
    let height = 70;
    let lineProps = []

    for (let i = 0; i < rows; i++) {
        let width_i = 20;
        for (const col of cols) {
            lineProps.push({width: col.width, height: 25, x: width_i, y: height})
            width_i += parseInt(col.width) + 20;
            width = Math.max(width, width_i);
        }
        height += (20 + 20);
    }

    return (
        <ContentLoader
            width={width}
            height={height}
            viewBox={"0 0 " + width + " " + height}
            backgroundColor="#f3f3f3"
            foregroundColor="#ecebeb"
        >
            <rect x="20" y="0" rx="5" ry="5" width="153" height="40"/>

            {lineProps.map((line, index) => (
                <rect key={"line" + index} x={line.x} y={line.y} rx="4" ry="4" width={line.width} height={line.height}/>
            ))}

        </ContentLoader>
    )
}

TableLoader.metadata = {
    name: 'Mohd Arif Un',
    github: 'arif-un',
    description: 'Data Table skeleton',
    filename: 'DataTable',
}


function SectionLoader({height = "h-64", message = null}) {
    return (
        <BoxSection additionalClasses={"flex flex-col items-center justify-center " + height}>
            {(message !== null) && <><div className="text-gray-800 dark:text-gray-200 mb-3">{message}</div></>}
            <div><BeatLoader color="rgb(209 213 219)" /></div>
        </BoxSection>
    )
}


export {TextLoader, TableLoader, SectionLoader};