const initialEditorText = await fetch("../typescript/test/assets/test.tex").then((result) => result.text());

const worker = new Worker("worker.js");
worker.postMessage({ type: "initialize" });

let numMessages = 0;

function DemoEditor() {
    const [editorText, setEditorText] = React.useState(initialEditorText);
    const [isCompiling, setIsCompiling] = React.useState(false);
    const [isInitialized, setIsInitialized] = React.useState(false);
    const [logContent, setLogContent] = React.useState([]);
    const [pdfDataUrl, setPdfDataUrl] = React.useState("");
    const logEndRef = React.createRef();

    React.useEffect(() => {
        logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    });

    worker.onmessage = (event) => {
        console.log("Main thread recieved", event)
        if (event.data.type === "initialized") {
            setIsInitialized(true);
        } else if (event.data.type === "print") {
            setLogContent([...logContent, <p className="m-0 p-0 text-monospace" key={numMessages++}>{event.data.message}</p>]);
        } else if (event.data.type === "printErr") {
            setLogContent([...logContent, <p className="m-0 p-0 text-monospace text-danger" key={numMessages++}>{event.data.message}</p>]);
        } else if (event.data.type === "compiled") {
            setIsCompiling(false);
            setPdfDataUrl(event.data.pdf);
            setLogContent([...logContent, <p className="m-0 p-0 text-monospace text-success" key={numMessages++}>Compile done!</p>]);
        }
    }

    return <div className="container">
        <div className="row mt-3">
            <div className="col">
                <button onClick={() => { worker.postMessage({type: "compile", tex: editorText}); setIsCompiling(true); }} disabled={isCompiling || !isInitialized}>Compile</button>
                { !(isInitialized) && <span>Initializing WASM, please wait...</span> }
                { pdfDataUrl!="" && <a download="main.pdf" href={pdfDataUrl}>Download PDF</a> }
            </div>
        </div>
        <div className="row mt-3 mh-75 h-75">
            <textarea className="col mh-100"  style={{fontFamily:"monospace"}} onChange={(e) => setEditorText(e.target.value)} value={editorText}></textarea>
            <div className="col mh-100 overflow-auto">{logContent}<div ref={logEndRef} /></div>
        </div>
    </div>;
}


const root = ReactDOM.render(
    <DemoEditor />,
    document.body
);

