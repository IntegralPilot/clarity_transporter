const http = require('http');
const busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const genes =  require('./genomicLoci.json');

if (genes == undefined) {
  console.log("Gene dictonary not found!");
  process.exit(1);
}

var isDevMode = false;
var successfulRequests = 0;

process.argv.forEach(function (val) {
  if (val === "--enable-dev") {
    isDevMode = true;
  }
});

function getBase(uuid, chr, base) {
  // Define the path to samtools and the BAM file
  const samtoolsPath = './samtools';
  const bamFilePath = `/tmp/${uuid}.bam`;

  // Construct the samtools command
  const samtoolsCommand = `${samtoolsPath} view ${bamFilePath} ${chr}:${base}-${base}`;

  return new Promise((resolve, reject) => {
    // Execute the samtools command
    exec(samtoolsCommand, (error, stdout, stderr) => {
      if (error) {
        reject(`Error executing samtools: ${stderr || error.message}`);
        return;
      }

      // Parse the samtools output to get the base
      const lines = stdout.trim().split('\t');

      if (lines.length < 10) {
        resolve(undefined); // The base is not found
        return;
      }

      // Get the starting base number
      const startingBase = parseInt(lines[3]);

      // Get the ATCG sequence
      const sequence = lines[9];

      // find our wanted base in the sequence
      const baseIndex = base - startingBase;

      // Get the atcg base
      const atcgBase = sequence[baseIndex];

      // Return the base
      if (atcgBase === "A" || atcgBase === "T" || atcgBase === "C" || atcgBase === "G") {
        resolve(atcgBase);
      } else {
        resolve(undefined); // The base is not found
      }
    });
  });
}

function uuidv4() {
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

function impload(error, whileDoing, uuid, code, res) {
  if (code === 403 || code === 401) {
    console.log("[🚨] 🚔 Caught a potential spoofed request while " + whileDoing + ": ", error);
  } else {
    console.log("[💥] 🚧 An error occured while " + whileDoing + ": ", error);
  }
  // delete the .bam and .bam.bai files
  try {
    fs.unlinkSync(`/tmp/${uuid}.bam`);
  } catch (err) {
    // no files to unlink - called before they were created
    // do nothing
  }
  // send a response to the client
  res.writeHead(code, { Connection: 'close' });
  res.end();
}

function land(res, uuid) {
  successfulRequests++;
  if (successfulRequests % 10 === 0 || successfulRequests === 1 || isDevMode) {
    console.log("[🥁] ✅ Successfully processed " + successfulRequests + ` ${successfulRequests === 1 ? "request" : "requests"}!`);
  }
  // delete the .bam and .bam.bai files
  try {
    fs.unlinkSync(`/tmp/${uuid}.bam`);
  } catch (err) {
    // no files to unlink - called before they were created
    // do nothing
  }
  res.writeHead(200, { Connection: 'close' });
  res.write(JSON.stringify({ error: "None!"}));
  res.end();
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    const uuid = uuidv4();
    if (isDevMode) {
      console.log("[🥁] 📥 Received transport request with uuid " + uuid + "!");
    }
    var fieldsAndFiles = {};
    var busboyInstance = busboy({ headers: req.headers,   limits: {
      fileSize: 10 * 1024 * 1024 * 1024 // 10GB in bytes
    }});

    let processingFiles = [];

busboyInstance.on('file', (fieldname, file) => {
  let filename;
  if (fieldname === "bam") {
    filename = `${uuid}.bam`;
  } else {
    impload(`Invalid fieldname (${fieldname})`, "processing files", uuid, 400, res);
    return;
  }

  const saveTo = path.join("/tmp", filename);
  file.pipe(fs.createWriteStream(saveTo));

  let fileProcessing = new Promise((resolve, reject) => {
    file.on('end', () => {
      fieldsAndFiles[fieldname] = saveTo;
      resolve();
    });

    file.on('error', (err) => {
      reject(err);
    });
  });

  processingFiles.push(fileProcessing);
});

    busboyInstance.on('field', (fieldname, val) => {
      fieldsAndFiles[fieldname] = val;
    });

    async function labelSNPs(uuid, genes, res) {
      var proteins = [];
    
      for (const gene of genes) {
        var loci = [];
        await Promise.all(
          gene.loci.map(async (locus) => {
            try {
              const base = await getBase(uuid, locus.chr, locus.pos);
    
              if (base == undefined) {
                throw new Error("Could not find base at position - is BAM formed correctly, and is it a human BAM?");
              }
              loci.push({base: base, name: locus.name});
            } catch (err) {
              loci.push({base: "N", name: locus.name});
            }
          })
        );
        proteins.push({ fullName: gene.fullName, abbreviation: gene.abbreviation, loci: loci });
      }
      const formData = new FormData();
      formData.append("uid", fieldsAndFiles["uid"]);
      formData.append("usid", fieldsAndFiles["usid"]);
      formData.append("cgA", "Please don't spoof requests to ClarityAPI. Really, it's way uncool.");
      formData.append("gD-1.0", JSON.stringify(proteins));
      formData.append("tid", fieldsAndFiles["tid"]);
      fetch(`${isDevMode ? "http://localhost:3000" : "https://clarityapi.vercel.app"}/api/geneticDataUploader`, {
        method: "POST",
        body: formData
      })
        .then((res2) => {
          if (res2.status !== 200) {
            impload(`Failed upload request (${res2.json().error})`, "uploading data", uuid, 401, res);
            return;
          }
          land(res, uuid);
        })
        .catch((err) => {
          impload(err, "uploading data", uuid, 500, res);
        })
    }

    busboyInstance.on('finish', () => {
      Promise.all(processingFiles)
        .then(() => {
          if ((fieldsAndFiles["cgA"] ?? "invalid") !== "Please don't spoof requests to ClarityAPI. Really, it's way uncool.") {
            impload("Invalid cgA", "validating requests", uuid, 400, res);
            return;
          }
          const uid = fieldsAndFiles["uid"];
          const usid = fieldsAndFiles["usid"];

          const formData = new FormData();
          formData.append("uid", uid);
          formData.append("usid", usid);
          formData.append("cgA", "Please don't spoof requests to ClarityAPI. Really, it's way uncool.");
          formData.append("wut", `["L.MANAGER", "L.UPLOADER"]`)
            fetch(`${isDevMode ? "http://localhost:3000" : "https://clarityapi.vercel.app"}/api/credentialVerifier`, {
              method: "POST",
              body: formData
            })
              .then((res2) => {
                if (res2.status !== 200) {
                  impload("Invalid credentials", "validating credentials", uuid, 401, res);
                  return;
                }
                // run samtools quickcheck on the .bam
                const samtools = spawn('./samtools', ['quickcheck', `/tmp/${uuid}.bam`]);
                // the .bam is invalid if samtools quickcheck returns a non-zero exit code
                samtools.on('close', (code) => {
                  if (code !== 0) {
                    impload("Invalid .bam file", "validating .bam file", uuid, 400, res);
                    return;
                  } else {
                    // index the .bam file
                    const samtools = spawn('./samtools', ['index', `/tmp/${uuid}.bam`]);
                    // the .bam is invalid if samtools index returns a non-zero exit code
                    samtools.on('close', (code) => {
                      if (code !== 0) {
                        impload("Invalid .bam file", "indexing .bam file", uuid, 400, res);
                        return;
                      } else {
                        // label the SNPs and finish the request
                        labelSNPs(uuid, genes, res);
                      }
                    });
                  }
                });
              })
              .catch((err) => {
                impload(err, "validating credentials", uuid, 500, res);
              })
        })
        .catch((err) => {
          impload(err, "processing files", uuid, 500, res);
        });
    });

    req.pipe(busboyInstance);
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[🚀] 🧬 ClarityTransporter started on port ${PORT}!`);
  if (isDevMode) {
    console.log("[🚀] 🩺 ClarityTransporter is running in dev mode! Start ClarityAPI on localhost:3000.");
  }
});

server.on('error', (err) => {
  console.error('Server error:', err);
});