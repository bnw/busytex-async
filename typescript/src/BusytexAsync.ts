import path from "path";

let busytex_bin_module = require('../../build/wasm/busytex.js');

let assert = console.assert;

export interface TexLiveConfig {
    getTexLiveListOfFiles: () => Promise<Array<string>>;
    loadTexLiveFile: (input: string) => Promise<ArrayBufferView>;
    binFolder: string;
    print: undefined | any;
    printErr: undefined | any;
    wasmUri?: string;
};

export class BusytexAsync {
    private static dirWork = '/work';
    private static dirTexLive = '/TexLive';
    private createdDirs: Set<string> = new Set<string>([BusytexAsync.dirWork, BusytexAsync.dirTexLive]);
    private busytexBin: any;
    private FS: any;
    private static fileStubContent = '';

    constructor(private texLiveConfig: TexLiveConfig) {}

    async initialize() {
        return this.initializeBusytexBin();
    }

    addFile(filename: string, content: ArrayBufferView) {
        assert(!filename.startsWith("/"), "Filename must be relative");
        assert(!filename.startsWith(BusytexAsync.dirWork));
        this.busytexBin.FS.writeFile(
            BusytexAsync.dirWork + "/" + filename,
            content
        );
    }

    readFile(filename: string): Uint8Array {
        assert(!filename.startsWith("/"), "Filename must be relative");
        return this.FS.readFile(BusytexAsync.dirWork + "/" + filename);
    }

    async run(programmWithArguments: string[]) {
        if (this.busytexBin === undefined) {
            this.initializeBusytexBin();
        }
        console.log("Wasm loaded");
        await this.callMain(programmWithArguments);
        console.log('Call mains done');
        this.busytexBin = undefined;
        return;
    }

    private async initializeBusytexBin() {
        const findFilePostHook = async (fnName: string, path: string) => {
            if (path === '') { return }
            let currentMemfsFileContent;
            try {
                currentMemfsFileContent = this.busytexBin.FS.readFile(path, { encoding: 'utf8' });
            } catch (error) {
                console.error("Error reading MEMFS:", path, error);
            }
            if (currentMemfsFileContent === BusytexAsync.fileStubContent) {
                await this.addTexLiveFile(path);
            }
        };

        let Module = {
            print: this.texLiveConfig.print,
            printErr: this.texLiveConfig.printErr,
            //thisProgram: this.thisProgram,
            kpathsea_search__post_hook_js: async (path: string) => findFilePostHook("kpathsea_search__post_hook_js", path),
            kpathsea_find_file_generic__post_hook_js: async (path: string) => findFilePostHook("kpathsea_find_file_generic__post_hook_js", path),
            noInitialRun: true,
            noExitRuntime: true,
            locateFile: this.texLiveConfig.wasmUri === undefined ?
                null :
                (path: string) => {
                    if (path.endsWith(".wasm")) {
                        return this.texLiveConfig.wasmUri;
                    }
                    return path;
                }
        };

        this.busytexBin = await busytex_bin_module(Module);
        const dirs = [BusytexAsync.dirTexLive, BusytexAsync.dirWork];
        for (let dir of dirs) {
            this.busytexBin.FS.mkdir(dir);
        }
        if (this.FS === undefined) {
            // This is the first initialization. Initialize the TexLive file stubs
            this.FS = this.busytexBin.FS;
            await this.addTexLiveFileStubs();
        } else {
            // Mount FS of previous module
            for (let dir of dirs) {
                this.busytexBin.FS.mount(
                    this.busytexBin.PROXYFS,
                    {
                        root: dir,
                        fs: this.FS
                    },
                    dir
                );
            }
        }
        this.busytexBin.FS.chdir("/work");
    }

    private async callMain(args: Array<string>) {
        assert(args.length > 0, "args must not be empty");
        const thisProgram = BusytexAsync.dirTexLive + "/" + this.texLiveConfig.binFolder + args[0];
        args.unshift(thisProgram);

        const argc = args.length;
        let argv = this.busytexBin._malloc((argc + 1) * 4);
        let argvPtr = argv;
        let newStrings: Array<number> = [];
        args.forEach((arg) => {
            const stringPtr = this.busytexBin.stringToNewUTF8(arg);
            newStrings.push(stringPtr);
            this.busytexBin.setValue(argvPtr, stringPtr, '*');
            argvPtr += 4;
        });

        const returnCode = await this.busytexBin.ccall('main', 'number', ['number', 'number'], [argc, argv], { async: true })
            .catch((error: any) => {
                // Converting ExitStatus object into the programs return code
                return error.status;
            });

        this.busytexBin._free(argv);
        newStrings.forEach((newString) => {
            this.busytexBin._free(newString);
        });
        return returnCode;
    }

    private async addTexLiveFile(texLiveRelativePath: string) {
        console.log("addTexLiveFile", texLiveRelativePath);
        assert(texLiveRelativePath.startsWith(BusytexAsync.dirTexLive));
        let content;
        try {
            const pathForFilerLoader = texLiveRelativePath.substr(BusytexAsync.dirTexLive.length);
            content = await this.texLiveConfig.loadTexLiveFile(pathForFilerLoader);
        } catch (error) {
            console.error("Error reading file", texLiveRelativePath, error);
        }
        try {
            this.busytexBin.FS.writeFile(texLiveRelativePath, content);
        } catch (error) {
            console.error("Error writen file to MEMFS", texLiveRelativePath, error);
        }
    }

    private async addTexLiveFileStubs() {
        let promises: Array<Promise<void>> = [];
        console.log("Start loading filenames");
        const filenamesTxt = await this.texLiveConfig.getTexLiveListOfFiles();
        let i = 0;
        for (let filename of filenamesTxt) {
            if (filename === "") { continue; }
            filename = BusytexAsync.dirTexLive + "/" + filename;
            this.ensureFolderOfFilePathExists(filename, this.FS);
            try {
                if (filename.endsWith(".cnf") || filename.endsWith("ls-R")) {
                    promises.push(this.addTexLiveFile(filename));
                } else {
                    this.FS.writeFile(filename, BusytexAsync.fileStubContent);
                }
            } catch (err) {
                console.error("writeFile failed:", filename, err);
            }
            i++;
            if (i % 10000 === 0) {
                console.log("Created files:", i);
            }
        }
        await Promise.all(promises);
        console.log("Done loading filenames");
    }

    private ensureFolderOfFilePathExists(filePath: string, FS: any) {
        let pathParts = "";
        let parts = filePath.split("/");
        parts.pop();
        parts.forEach(path => {
            if (path === "") { return; }
            if (path[0] === '.') { return; }
            pathParts += "/" + path;
            if (this.createdDirs.has(pathParts)) {
                return;
            }
            this.createdDirs.add(pathParts);
            try {
                FS.mkdir(pathParts);
            } catch (err) {
                console.error("mkdir failed:", pathParts, err);
            }
        });
    }

    private async post_main_hook_js(command: string) {
        console.log("post_main_hook_js", command);
    }
}