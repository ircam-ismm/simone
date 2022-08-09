import Mfcc from 'waves-lfo/common/operator/Mfcc.js';
// import createKDTree from 'static-kdtree';

export default new Blob ([
  `
  onmessage = e => {
  console.log('in workr', e.data);
  // self.postMessage(e.hopSize);
  // postMessage(e.data);


  const mfccAnalyzer = new Mfcc(e.mfccParams);
  mfccAnalyzer.initStream(e.mfccInit);
  postMessage(e.data);

  // const mfccFrames = [];
  // const times = [];
  // const means = new Float32Array(e.mfccParams.nbrCoefs);
  // const std = new Float32Array(e.mfccParams.nbrCoefs);

  // for (let i = 0; i < buffer.length; i += e.hopSize) {
  //   const frame = e.bufferData.subarray(i, i + e.frameSize);
  //   times.push(i / e.mfccInit.sourceSampleRate);
  //   const cepsFrame = e.mfccAnalyzer.inputSignal(frame);
  //   mfccFrames.push(Array.from(cepsFrame));
  //   for (let j = 0; j < e.mfccParams.nbrCoefs; j++) {
  //     means[j] += cepsFrame[j];
  //   }
  // }
  // // get means and std
  // for (let j = 0; j < e.mfccParams.nbrCoefs; j++) {
  //   means[j] /= mfccFrames.length;
  // }
  // for (let i = 0; i < mfccFrames.length; i++) {
  //   const cepsFrame = mfccFrames[i];
  //   for (let j = 0; j < e.mfccParams.nbrCoefs; j++) {
  //     std[j] += (cepsFrame[j] - means[j]) ** 2
  //   }
  // }
  // for (let j = 0; j < e.mfccParams.nbrCoefs; j++) {
  //   std[j] /= mfccFrames.length;
  //   std[j] = Math.sqrt(std[j]);
  // }

  // // normalize
  // for (let i = 0; i < mfccFrames.length; i++) {
  //   for (let j = 0; j < e.mfccParams.nbrCoefs; j++) {
  //     mfccFrames[i][j] = (mfccFrames[i][j] - means[j]) / std[j];
  //   }
  // }

  // const searchTree = createKDTree(mfccFrames);
  // postMessage([searchTree, times]);
}
`
]);

