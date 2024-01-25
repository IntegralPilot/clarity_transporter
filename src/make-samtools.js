// makes samtools for the current platform and places a binary (samtools) at the root of the project
// requires: release 1.19.2 of samtools source code in the samtools-1.19.2/ directory
//
// usage: node make-samtools.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const platform = process.platform;
const arch = process.arch;

const samtoolsDir = path.join(".", 'samtools-1.19.2');

if (!fs.existsSync(samtoolsDir)) {
    console.log("samtools source code not found. Please clone the samtools repository into the samtools/ directory.");
    process.exit(1);
}

console.log("Building samtools for " + platform + " " + arch + "...");

const configureCommand = `cd ${samtoolsDir} && ./configure --prefix=/tmp`;

const makeCommand = `cd ${samtoolsDir} && make`;

const installCommand = `cd ${samtoolsDir} && make install`;

const copyCommand = `cp /tmp/bin/samtools .`

try {
    execSync(configureCommand);
    execSync(makeCommand);
    execSync(installCommand);
    execSync(copyCommand);
} catch (err) {
    console.log("Error building samtools: ", err);
    process.exit(1);
}





