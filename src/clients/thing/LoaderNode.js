import tempy, { temporaryFileTask } from 'tempy';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import pkg from 'node-web-audio-api';
const { load } = pkg;

export default class Loader {
  constructor(audioContext) {
    this.audioContext = audioContext;
  }

  async load(resource) {
    return new Promise((resolve, reject) => {
      const extension = path.extname(resource).replace(/^\./, ''); // remove leading '.'
      const protocol = new URL(resource).protocol.replace(/:$/, ''); // remove trailing ":"
      const http_ = protocol === 'http' ? http : https;

      tempy.file.task(async (tempfile) => {
        return new Promise(async (resolveTask, reject) => {
          const file = fs.createWriteStream(tempfile);

          const request = http_.get(resource, { rejectUnauthorized: false }, (response) => {
            response.pipe(file);
            // after download completed close filestream
            file.on("finish", async () => {
              file.close();

              // console.log(fs.readFileSync(tempfile));
              const fileRs = load(tempfile);
              const buffer = await this.audioContext.decodeAudioData(fileRs);
              // console.log(buffer);

              resolve(buffer);
              resolveTask(); // clean tmp file
            });
          });
        });
      }, { extension });
    });

  }
}
