onmessage = e => {
  const mfccFrames = [];
  const times = [];
  const means = new Float32Array(e.mfccCoefs);
  const std = new Float32Array(e.mfccCoefs);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < buffer.length; i += e.hopSize) {
    const frame = channelData.subarray(i, i + e.frameSize);
    times.push(i / e.sampleRate);
    const cepsFrame = e.mfccAnalyzer.inputSignal(frame);
    mfccFrames.push(Array.from(cepsFrame));
    for (let j = 0; j < e.mfccCoefs; j++) {
      means[j] += cepsFrame[j];
    }
  }
  // get means and std
  for (let j = 0; j < e.mfccCoefs; j++) {
    means[j] /= mfccFrames.length;
  }
  for (let i = 0; i < mfccFrames.length; i++) {
    const cepsFrame = mfccFrames[i];
    for (let j = 0; j < e.mfccCoefs; j++) {
      std[j] += (cepsFrame[j] - means[j]) ** 2
    }
  }
  for (let j = 0; j < e.mfccCoefs; j++) {
    std[j] /= mfccFrames.length;
    std[j] = Math.sqrt(std[j]);
  }

  // normalize
  for (let i = 0; i < mfccFrames.length; i++) {
    for (let j = 0; j < e.mfccCoefs; j++) {
      mfccFrames[i][j] = (mfccFrames[i][j] - means[j]) / std[j];
    }
  }

  createKDTree = e.createKDTreeFunc;
  const searchTree = e.createKDTree(mfccFrames);
  postMessage([searchTree, times]);
}

// function computeMfcc(buffer) { // make aynchronous ?
//   const mfccFrames = [];
//   const times = [];
//   const means = new Float32Array(this.mfccCoefs);
//   const std = new Float32Array(this.mfccCoefs);
//   const channelData = buffer.getChannelData(0);

//   for (let i = 0; i < buffer.length; i += this.hopSize) {
//     const frame = channelData.subarray(i, i + this.frameSize);
//     times.push(i / this.sourceSampleRate);
//     const cepsFrame = this.mfcc.inputSignal(frame);
//     mfccFrames.push(Array.from(cepsFrame));
//     for (let j = 0; j < this.mfccCoefs; j++) {
//       means[j] += cepsFrame[j];
//     }
//   }
//   // get means and std
//   for (let j = 0; j < this.mfccCoefs; j++) {
//     means[j] /= mfccFrames.length;
//   }
//   for (let i = 0; i < mfccFrames.length; i++) {
//     const cepsFrame = mfccFrames[i];
//     for (let j = 0; j < this.mfccCoefs; j++) {
//       std[j] += (cepsFrame[j] - means[j]) ** 2
//     }
//   }
//   for (let j = 0; j < this.mfccCoefs; j++) {
//     std[j] /= mfccFrames.length;
//     std[j] = Math.sqrt(std[j]);
//   }

//   // normalize
//   for (let i = 0; i < mfccFrames.length; i++) {
//     for (let j = 0; j < this.mfccCoefs; j++) {
//       mfccFrames[i][j] = (mfccFrames[i][j] - means[j]) / std[j];
//     }
//   }
//   console.log('analysis done');
//   return [mfccFrames, times, means, std];
// }