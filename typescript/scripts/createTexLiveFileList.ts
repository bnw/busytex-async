import * as ftp from "basic-ftp"
import * as fs from 'fs';

function isExcludedDir(path: string) {
    const excludedDirs = [
        "/texlive/Contents/live/texmf-dist/doc/"
    ];
    return excludedDirs.some((dir) => path.startsWith(dir));
}

async function main() {
    const outFile = "TexLiveFiles.txt";

    const client = new ftp.Client()
    await client.access({
        host: "tug.org",
        secure: false
    });

    async function traverseDir(path: string) {
        console.log("traversing", path);
        let files = await client.list(path);
        for (let file of files) {
            let filePath: string = path + "/" + file.name;
            if (file.isDirectory) {
                if (isExcludedDir(filePath)) {
                    continue;
                }
                await traverseDir(filePath);
            } else if (file.isFile || file.isSymbolicLink) {
                fs.appendFileSync(outFile, filePath + "\n");
            }
        }
    }

    fs.writeFileSync(outFile, "");
    traverseDir("/texlive/Contents/live");
}


main();