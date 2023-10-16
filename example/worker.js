importScripts("../build-js/src/BusytexAsync.browser.js");



const tugOrgTexLiveConfig = {
    getTexLiveListOfFiles: async () => {
        const newlineSeperatedFileList = await fetch("../typescript/test/assets/TexLiveFilesTugOrg.txt").then((result) => result.text());
        return Promise.resolve(newlineSeperatedFileList.split("\n"));
    },
    loadTexLiveFile: async (filepath) => {
        let result = await fetch("https://corsproxy.io/?https://tug.org/" + filepath);
        return result.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    },
    binFolder: "texlive/Contents/live/bin/x86_64-linux/",
    print: (message) => postMessage({ type: "print", message: message }),
    printErr: (message) => postMessage({ type: "printErr", message: message }),
    wasmUri: "../build/wasm/busytex.wasm",
};
const busytexAsync = new BusytexAsync.BusytexAsync(tugOrgTexLiveConfig);

onmessage = async (event) => {
    console.log("recieved", event)
    if (event.data.type === "initialize") {
        console.log("recieved initialize")
        await busytexAsync.initialize();
        postMessage({ type: "initialized" });
    } else if(event.data.type === "compile"){
        busytexAsync.addFile("main.tex", event.data.tex); 
        await busytexAsync.run(["pdflatex", "-interaction=nonstopmode", "main.tex"]);
        let result = busytexAsync.readFile("main.pdf");
        let blob = new Blob([result], {type: "application/octet-stream"});
        postMessage({ type: "compiled", pdf: URL.createObjectURL(blob) });
    }
};