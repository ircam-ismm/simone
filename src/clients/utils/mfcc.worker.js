addEventListener('message', e => {
  const {type, data} = e.data;
  if (type === 'message') {
    postMessage({ 
      type: 'message', 
      data,
    });
  }
  if (type === 'analyze-source' || type === 'analyze-target') {
    console.log('begin analysis');
    const init = data.analysisInitData;
    const analyzer = new Mfcc(init.mfccBands, init.mfccCoefs, init.mfccMinFreq, init.mfccMaxFreq, init.frameSize, init.sampleRate);
    const [mfccFrames, times, means, std, minRms, maxRms] = analyzer.computeBufferMfcc(data.buffer, init.hopSize);
    postMessage({
      type,
      data: {
        mfccFrames, 
        times,
        means, 
        std,
        minRms,
        maxRms,
      }
    });
  }
});


class Mfcc {
  constructor(nbrBands, nbrCoefs, minFreq, maxFreq, frameSize, sampleRate) {
    this.nbrBands = nbrBands;
    this.nbrCoefs = nbrCoefs;
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
    this.frameSize = frameSize;
    this.sampleRate = sampleRate;

    this.fft = new Fft('power', this.frameSize, this.frameSize, this.frameSize);
    this.mel = new Mel(this.frameSize / 2 + 1, this.nbrBands, true, 1, this.minFreq, this.maxFreq, this.sampleRate);
    this.dct = new Dct(this.nbrCoefs, this.nbrBands);
  }

  get(data) {
    const bins = this.fft.get(data);
    const melBands = this.mel.get(bins);
    const coefs = this.dct.get(melBands);

    return coefs;
  }

  computeBufferMfcc(channelData, hopSize) {
    console.log("analysing file");
    const mfccFrames = [];
    const times = [];
    const means = new Float32Array(this.nbrCoefs);
    const std = new Float32Array(this.nbrCoefs);
    const data = new Float32Array(this.frameSize);
    let maxRms = 0;
    let minRms = 10000;

    for (let i = 0; i < channelData.length; i += hopSize) {
      const frame = channelData.subarray(i, i + this.frameSize);
      let frameRms = 0;
      for (let j = 0; j < frame.length; j++) {
        data[j] = frame[j];
        frameRms += frame[j]**2;
      }
      for (let j = frame.length; j < this.frameSize; j++) {
        data[j] = 0;
      }
      times.push(i / this.sampleRate);
      const cepsFrame = this.get(data);
      mfccFrames.push(Array.from(cepsFrame));
      for (let j = 0; j < this.nbrCoefs; j++) {
        means[j] += cepsFrame[j];
      }
      frameRms = Math.sqrt(frameRms/frame.length);
      if (frameRms > maxRms) {
        maxRms = frameRms;
      } 
      if (frameRms < minRms) {
        minRms = frameRms;
      } 
    }
    for (let j = 0; j < this.nbrCoefs; j++) {
      means[j] /= mfccFrames.length;
    }
    for (let i = 0; i < mfccFrames.length; i++) {
      const cepsFrame = mfccFrames[i];
      for (let j = 0; j < this.nbrCoefs; j++) {
        std[j] += (cepsFrame[j] - means[j]) ** 2
      }
    }
    for (let j = 0; j < this.nbrCoefs; j++) {
      std[j] /= mfccFrames.length;
      std[j] = Math.sqrt(std[j]);
    }

    for (let i = 0; i < mfccFrames.length; i++) {
      for (let j = 0; j < this.nbrCoefs; j++) {
        mfccFrames[i][j] = (mfccFrames[i][j] - means[j]) / std[j];
      }
    }
    console.log('analysis done');
    return [mfccFrames, times, means, std, minRms, maxRms];
  }
}

class Dct {
  constructor(order, nbrBands) {
    this.order = order;
    this.nbrBands = nbrBands;

    this.weightMatrix = getDctWeights(order, nbrBands);


  }

  get(data) {
    var weights = this.weightMatrix;
    const dataSize = data.length;
    const out = new Float32Array(this.order);

    for (var k = 0; k < this.order; k++) {
      var offset = k * dataSize;
      out[k] = 0;

      for (var n = 0; n < dataSize; n++) {
        out[k] += data[n] * weights[offset + n];
      }
    }

    return out;
  }
}

function getDctWeights(order, N) {
  var weights = new Float32Array(N * order);
  var piOverN = Math.PI / N;
  var scale0 = 1 / Math.sqrt(2);
  var scale = Math.sqrt(2 / N);

  for (var k = 0; k < order; k++) {
    let s;
    if (k === 0) {
      s = scale0 * scale;
    } else {
      s = scale;
    }

    for (var n = 0; n < N; n++) {
      weights[k * N + n] = s * Math.cos(k * (n + 0.5) * piOverN);
    }
  }

  return weights;
}


class Mel {
  constructor(nbrBins, nbrBands, log, power, minFreq, maxFreq, sampleRate) {
    this.nbrBins = nbrBins;
    this.nbrBands = nbrBands;
    this.log = log;
    this.power = power;
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
    this.sampleRate = sampleRate;

    this.melBandDescriptions = getMelBandWeights(nbrBins, nbrBands, sampleRate, minFreq, maxFreq);
  }

  get(data) {
    const melBands = new Float32Array(this.nbrBands);

    var scale = 1;

    var minLogValue = 1e-48;
    var minLog = -480;
    if (this.log) scale *= this.nbrBands;

    for (var i = 0; i < this.nbrBands; i++) {
      var _melBandDescriptions$ = this.melBandDescriptions[i],
        startIndex = _melBandDescriptions$.startIndex,
        weights = _melBandDescriptions$.weights;

      var value = 0;

      for (var j = 0; j < weights.length; j++) {
        value += weights[j] * data[startIndex + j];
      } 
      if (scale !== 1) value *= scale;

      if (this.log) {
        if (value > minLogValue) value = 10 * Math.log10(value); else value = minLog;
      }

      if (this.power !== 1) value = Math.pow(value, this.power);

      melBands[i] = value;
    }

    return melBands;
  }
}

function hertzToMelHtk(freqHz) {
  return 2595 * (0, Math.log10)(1 + freqHz / 700);
}

function melToHertzHtk(freqMel) {
  return 700 * (Math.pow(10, freqMel / 2595) - 1);
}

function getMelBandWeights(nbrBins, nbrBands, sampleRate, minFreq, maxFreq) {
  var hertzToMel = null;
  var melToHertz = null;
  var minMel = undefined;
  var maxMel = undefined;

  hertzToMel = hertzToMelHtk;
  melToHertz = melToHertzHtk;
  minMel = hertzToMel(minFreq);
  maxMel = hertzToMel(maxFreq);

  var melBandDescriptions = new Array(nbrBands);
  var fftFreqs = new Float32Array(nbrBins);
  var filterFreqs = new Float32Array(nbrBands + 2);

  var fftSize = (nbrBins - 1) * 2;
  for (var i = 0; i < nbrBins; i++) {
    fftFreqs[i] = sampleRate * i / fftSize;
  } for (var _i = 0; _i < nbrBands + 2; _i++) {
    filterFreqs[_i] = melToHertz(minMel + _i / (nbrBands + 1) * (maxMel - minMel));
  }
  for (var _i2 = 0; _i2 < nbrBands; _i2++) {
    var minWeightIndexDefined = 0;

    var description = {
      startIndex: null,
      centerFreq: null,
      weights: [],
    };

    for (var j = 0; j < nbrBins - 1; j++) {
      var posSlopeContrib = (fftFreqs[j] - filterFreqs[_i2]) / (filterFreqs[_i2 + 1] - filterFreqs[_i2]);

      var negSlopeContrib = (filterFreqs[_i2 + 2] - fftFreqs[j]) / (filterFreqs[_i2 + 2] - filterFreqs[_i2 + 1]);

      var contribution = Math.max(0, Math.min(posSlopeContrib, negSlopeContrib));

      if (contribution > 0) {
        if (description.startIndex === null) {
          description.startIndex = j;
          description.centerFreq = filterFreqs[_i2 + 1];
        }
        description.weights.push(contribution);
      }
    }

    if (description.startIndex === null) {
      description.startIndex = 0;
      description.centerFreq = 0;
    }
    melBandDescriptions[_i2] = description;
  }

  return melBandDescriptions;
}

class Fft {
  constructor(mode, frameSize, fftSize, windowSize) {
    this.mode = mode;
    this.frameSize = frameSize;
    this.fftSize = fftSize;
    this.windowSize = windowSize;
    this.window = new Float32Array(this.windowSize);
    this.normCoefs = { linear: 0, power: 0 };

    hannWindow(this.window, windowSize, this.normCoefs);

    this.real = new Float32Array(fftSize);
    this.imag = new Float32Array(fftSize);
    this.fft = new FftNayuki(fftSize);
  }

  get(data) {
    const outData = new Float32Array(this.fftSize / 2 + 1);

    for (var i = 0; i < this.windowSize; i++) {
      this.real[i] = data[i] * this.window[i] * this.normCoefs.power;
      this.imag[i] = 0;
    }


    for (var _i = this.windowSize; _i < this.fftSize; _i++) {
      this.real[_i] = 0;
      this.imag[_i] = 0;
    }

    this.fft.forward(this.real, this.imag);

    if (this.mode === 'magnitude') {
      var norm = 1 / this.fftSize;


      var realDc = this.real[0];
      var imagDc = this.imag[0];
      outData[0] = sqrt(realDc * realDc + imagDc * imagDc) * norm;


      var realNy = this.real[this.fftSize / 2];
      var imagNy = this.imag[this.fftSize / 2];
      outData[this.fftSize / 2] = sqrt(realNy * realNy + imagNy * imagNy) * norm;


      for (var _i2 = 1, j = this.fftSize - 1; _i2 < this.fftSize / 2; _i2++, j--) {
        var real = 0.5 * (this.real[_i2] + this.real[j]);
        var imag = 0.5 * (this.imag[_i2] - this.imag[j]);

        outData[_i2] = 2 * sqrt(real * real + imag * imag) * norm;
      }
    } else if (this.mode === 'power') {
      var _norm = 1 / (this.fftSize * this.fftSize);


      var _realDc = this.real[0];
      var _imagDc = this.imag[0];
      outData[0] = (_realDc * _realDc + _imagDc * _imagDc) * _norm;


      var _realNy = this.real[this.fftSize / 2];
      var _imagNy = this.imag[this.fftSize / 2];
      outData[this.fftSize / 2] = (_realNy * _realNy + _imagNy * _imagNy) * _norm;

 
      for (var _i3 = 1, _j = this.fftSize - 1; _i3 < this.fftSize / 2; _i3++, _j--) {
        var _real = 0.5 * (this.real[_i3] + this.real[_j]);
        var _imag = 0.5 * (this.imag[_i3] - this.imag[_j]);

        outData[_i3] = 4 * (_real * _real + _imag * _imag) * _norm;
      }
    }

    return outData;
  }
}

class FftNayuki {
  constructor(n) {
    this.n = n;
    this.levels = -1;

    for (var i = 0; i < 32; i++) {
      if (1 << i == n) {
        this.levels = i; 
      }
    }

    if (this.levels == -1) {
      throw "Length is not a power of 2";
    }

    this.cosTable = new Array(n / 2);
    this.sinTable = new Array(n / 2);

    for (var i = 0; i < n / 2; i++) {
      this.cosTable[i] = Math.cos(2 * Math.PI * i / n);
      this.sinTable[i] = Math.sin(2 * Math.PI * i / n);
    }
  }

  forward(real, imag) {
    var n = this.n;

    for (var i = 0; i < n; i++) {
      var j = reverseBits(i, this.levels);

      if (j > i) {
        var temp = real[i];
        real[i] = real[j];
        real[j] = temp;
        temp = imag[i];
        imag[i] = imag[j];
        imag[j] = temp;
      }
    }

    for (var size = 2; size <= n; size *= 2) {
      var halfsize = size / 2;
      var tablestep = n / size;

      for (var i = 0; i < n; i += size) {
        for (var j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
          var tpre = real[j + halfsize] * this.cosTable[k] + imag[j + halfsize] * this.sinTable[k];
          var tpim = -real[j + halfsize] * this.sinTable[k] + imag[j + halfsize] * this.cosTable[k];
          real[j + halfsize] = real[j] - tpre;
          imag[j + halfsize] = imag[j] - tpim;
          real[j] += tpre;
          imag[j] += tpim;
        }
      }
    }

    function reverseBits(x, bits) {
      var y = 0;

      for (var i = 0; i < bits; i++) {
        y = y << 1 | x & 1;
        x >>>= 1;
      }

      return y;
    }
  };

  inverse(real, imag) {
    forward(imag, real);
  };
}

function hannWindow(buffer, size, normCoefs) {
  var linSum = 0;
  var powSum = 0;
  var step = 2 * Math.PI / size;

  for (var i = 0; i < size; i++) {
    var phi = i * step;
    var value = 0.5 - 0.5 * Math.cos(phi);

    buffer[i] = value;

    linSum += value;
    powSum += value * value;
  }

  normCoefs.linear = size / linSum;
  normCoefs.power = Math.sqrt(size / powSum);
}


