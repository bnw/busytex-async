import { BusytexAsync, TexLiveConfig } from "../src/BusytexAsync";
import * as fs from 'fs';
import * as ftp from "basic-ftp"
import axios from 'axios';
import { Writable } from "stream";
var MemoryStream = require('memorystream');

var assert = require('assert');

suite('BusytexAsync', function () {
    test('Compiles', async function () {
        this.timeout(1000 * 60 * 2);

        const tugOrgTexLiveConfig: TexLiveConfig = {
            getTexLiveListOfFiles: () => {
                const newlineSeperatedFileList = fs.readFileSync("typescript/test/assets/TexLiveFilesTugOrg.txt");
                return Promise.resolve(newlineSeperatedFileList.toString().split("\n"));
            },
            loadTexLiveFile: async (filepath: string) => {
                let result = await axios.get("https://tug.org/" + filepath, {responseType: 'arraybuffer'});
                return Promise.resolve(result.data);
            },
            binFolder: "texlive/Contents/live/bin/x86_64-linux/",
            print: console.log.bind(console),
            printErr: console.error.bind(console)
        };

        let busytexAsync = new BusytexAsync(tugOrgTexLiveConfig);
        await busytexAsync.initialize();
        busytexAsync.addFile("test.tex", fs.readFileSync("typescript/test/assets/test.tex"));
        busytexAsync.addFile("troll.jpg", fs.readFileSync("typescript/test/assets/test.jpg"));
        await busytexAsync.run(["pdflatex", "test.tex"]);
        
        const result = busytexAsync.readFile("test.pdf");
        const pdfParseResult = await require('pdf-parse')(result);
        assert(pdfParseResult.numpages === 3);
        assert(pdfParseResult.text.includes("Conference Paper Title"));
    });
});
