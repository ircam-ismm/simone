import { render, html } from 'lit/html.js';

/**
  A web component for displaying a waveform, a cursor and a selection over the waveform
*/
export default class WaveformDisplay {

  /**
   * Creates the component
   * @param {number} height - The height (in px) of the component
   * @param {number} width - The width (in px) of the component
   * @param {boolean} selection - Whether or not selection is activated
   * @param {boolean} cursor - Whether or not cursor display is activated
   * @param {boolean} freeSelection - Whether of not selection is made by "highlighting" or
                                      by dragging a fixed size selection
   */
  constructor(height, width, selection = false, cursor = false, freeSelection = true) {
    this.height = height;
    this.width = width;
    this.hasSelection = selection;
    this.hasCursor = cursor;
    this.freeSelection = freeSelection; // Decides whether selection is made 
    // like you would select text or by dragging a fixed size selection

    this.container = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.container.setAttribute('height', `${this.height}`);
    this.container.setAttribute('width', `${this.width}`);
    this.container.style.backgroundColor = "#1c1c1c";
    

    this.waveformSvg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.waveformSvg.setAttribute('fill', 'none');
    this.waveformSvg.setAttribute('shape-rendering', 'crispEdges');
    this.waveformSvg.setAttribute('stroke', 'white');
    this.waveformSvg.style.opacity = 1;
    this.container.appendChild(this.waveformSvg);

    const straightLinePath = `M 0,${this.height / 2}L ${this.width},${this.height / 2}`;
    this.waveformSvg.setAttributeNS(null, 'd', straightLinePath);

    if (this.hasSelection) {
      this.selectionStartTime = 0;
      this.selectionStartPos = 0;
      this.selectionEndTime = 0;
      this.selectionEndPos = 0;
      this.selectionOffset = 0;

      this.selectionSvg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      this.selectionSvg.setAttribute('fill', 'white');
      this.selectionSvg.setAttribute('y', '0');
      this.selectionSvg.setAttribute('height', `${this.height}`);
      this.selectionSvg.style.opacity = 0.4;
      this.selectionSvg.setAttribute('x', `${this.selectionStartPos}`);
      this.selectionSvg.setAttribute('width', `${this.selectionEndPos - this.selectionStartPos}`);
      this.container.appendChild(this.selectionSvg);
    }

    if (this.hasCursor) {
      this.cursorSvg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      this.cursorSvg.setAttribute('fill', 'none');
      this.cursorSvg.setAttribute('shape-rendering', 'crispEdges');
      this.cursorSvg.setAttribute('stroke', 'red');
      this.cursorSvg.style.opacity = 1;
      this.container.appendChild(this.cursorSvg);
    }
    

    this.mouseDown = this.mouseDown.bind(this);
    this.mouseMove = this.mouseMove.bind(this);
    this.mouseUp = this.mouseUp.bind(this);
    this.touchStartTarget = this.touchStartTarget.bind(this);
    this.touchMoveTarget = this.touchMoveTarget.bind(this);
    this.touchEndTarget = this.touchEndTarget.bind(this);

    this.activePointers = new Map();
    this.pointerIds = []; // we want to keep the order of appearance consistant

    if (this.hasSelection) {
      if (this.freeSelection) {
        this.container.addEventListener('mousedown', this.mouseDown);
        this.container.addEventListener('touchstart', this.touchStartTarget);
      } else {
        this.selectionSvg.addEventListener('mousedown', this.mouseDown);
        this.selectionSvg.addEventListener('touchstart', this.touchStartTarget);
      }
    }
    
  }

  /**
   * Sets the buffer containing the sound file whose waveform you want to display 
   * @param {AudioBuffer} buffer - the AudioBuffer 
   */
  setBuffer(buffer) {
    this.buffer = buffer;
    this.bufferDuration = buffer.duration;
    this.startTime = 0;
    this.endTime = this.bufferDuration;
    this.duration = this.bufferDuration;

    this.averageAndNormalize();
    this.computeWaveformPath();
  }

  /**
   * Sets the time from which the displayed waveform must begin
   * @param {number} time - the start time in seconds
   */
  setStartTime(time) {
    time = Math.min(Math.max(time, 0), this.bufferDuration);
    this.startTime = time;
    this.duration = this.endTime - this.startTime; 
  
    this.computeWaveformPath();
  }

  /**
   * Sets the time from which the displayed waveform must end
   * @param {number} time - the end time in seconds
   */
  setEndTime(time) {
    time = Math.min(Math.max(time, 0), this.bufferDuration);
    this.endTime = time;
    this.duration = this.endTime - this.startTime;

    this.computeWaveformPath();
  }

  /**
   * Sets the time from which the selection must begin 
   * !!! Only available if freeSelection is false
   * @param {number} time - the start time (in s) of the selection
   */
  setSelectionStartTime(time) {
    this.selectionStartPos = this.width * (time - this.startTime) / this.duration;
    this.selectionEndPos = this.selectionStartPos + this.selectionWidth;
    this.selectionOffset = this.selectionStartPos;
    this.selectionSvg.setAttribute('x', this.selectionStartPos);

    if (this.cbSelectionChange) {
      const selectionStartTime = this.duration * this.selectionStartPos / this.width + this.startTime;
      const selectionEndTime = this.duration * this.selectionEndPos / this.width + this.startTime;
      this.cbSelectionChange(selectionStartTime, selectionEndTime);
    } 
  }

  /**
   * Sets the length of the selection 
   * !!! Only available if freeSelection is false
   * @param {number} time - the length (in s) of the selection)
   */
  setSelectionLength(time) {
    this.selectionWidth = this.width * time / this.duration;
    this.selectionEndPos = this.selectionStartPos + this.selectionWidth;
    this.selectionSvg.setAttribute('width', `${this.selectionWidth}`);

    if (this.cbSelectionChange) {
      const selectionStartTime = this.duration * this.selectionStartPos / this.width + this.startTime;
      const selectionEndTime = this.duration * this.selectionEndPos / this.width + this.startTime;
      this.cbSelectionChange(selectionStartTime, selectionEndTime);
    }
  }

  /**
   * Sets the time at which the cursor must appear on the waveform
   * @param {number} time - the time (in s)
   */
  setCursorTime(time) {
    time = Math.min(Math.max(time, this.startTime), this.endTime);
    const xPos = this.width * (time - this.startTime) / this.duration;
    const d = `M ${xPos}, 0 L ${xPos}, ${this.height}`;
    this.cursorSvg.setAttribute('d', d);
  }

  /**
   * Averages (when more than 1 channel) and normalizes data in buffer channels
   * to prepare for display
   */
  averageAndNormalize() {
    let maxVal = 0;
    const avgBuffer = [];

    if (this.buffer.numberOfChannels > 1) {
      const chan1 = this.buffer.getChannelData(0);
      const chan2 = this.buffer.getChannelData(1);
      for (let i = 0; i < chan1.length; i++) {
        const val1 = chan1[i];
        const val2 = chan2[i];
        const avg = (val1 + val2) / 2;
        if (maxVal < Math.abs(avg)) {
          maxVal = Math.abs(avg);
        }
        avgBuffer.push(avg);
      }
    } else {
      const chan1 = this.buffer.getChannelData(0);
      for (let i = 0; i < chan1.length; i++) {
        const val = chan1[i];
        if (maxVal < Math.abs(val)) {
          maxVal = Math.abs(val);
        }
        avgBuffer.push(val);
      }
    }

    this.bufferData = avgBuffer.map(val => {
      if (maxVal > 0) {
        return val / maxVal;
      } else {
        return val;
      }
    });
  }

  /**
   * Computes the SVG path of the waveform between this.startTime and this.endTime
   */
  computeWaveformPath() {
    const startIdx = this.startTime * this.buffer.sampleRate;
    const endIdx = this.endTime * this.buffer.sampleRate;
    const idxStep = Math.floor((endIdx - startIdx) / this.width);

    const waveformLimits = [];

    for (let pix = 0; pix < this.width; pix++) {
      let sliceData = this.bufferData.slice(startIdx + pix * idxStep, startIdx + (pix + 1) * idxStep);

      // if (pix === this.width - 1) {
      //   sliceData = normBuffer.slice(startIdx + pix * idxStep, endIdx);
      // } else {
      //   sliceData = normBuffer.slice(startIdx + pix * idxStep, startIdx + (pix + 1) * idxStep);
      // }

      let min = 1;
      let max = -1;

      //get min/max of average
      for (let i = 0; i < sliceData.length; i++) {
        const val = sliceData[i];
        if (val < min) {
          min = val;
        }
        if (val > max) {
          max = val;
        }
      }


      const minPx = (1 - min) * this.height / 2;
      const maxPx = (1 - max) * this.height / 2;
      waveformLimits.push([minPx, maxPx]);
    }

    let path = waveformLimits.map((datum, index) => {
      const x = index;
      let y1 = Math.round(datum[0]);
      let y2 = Math.round(datum[1]);
      // return `${x},${ZERO}L${x},${y1}L${x},${y2}L${x},${ZERO}`;
      return `${x},${y1}L${x},${y2}`;
    });

    path = 'M' + path.join('L');
    this.waveformSvg.setAttribute('d', path);
  }


  /**
   * Sets the function to call when selection is changed by the user
   * @param {function} callback - a function with two arguments : 
   *      - start: the time (in s) at which the selection begins
   *      - end: the time (in s) at which the selection ends
   * 
   */
  setCallbackSelectionChange(callback) {
    this.cbSelectionChange = callback;
  }


  /////////////////////////////////////////////////////////
  //
  //            Selection event listeners
  //
  /////////////////////////////////////////////////////////
  mouseDown(e) {
    this.clickTargetDim = e.currentTarget.getBoundingClientRect();
    this.mouseDownX = e.clientX;
    window.addEventListener('mousemove', this.mouseMove);
    window.addEventListener('mouseup', this.mouseUp);
  }

  mouseMove(e) {
    e.preventDefault(); // Prevent selection
    if (this.freeSelection) {
      const mouseClickX = this.mouseDownX - this.clickTargetDim.left;
      const mouseMoveX = Math.max(0, Math.min(e.clientX - this.clickTargetDim.left, this.width));
      this.selectionStartPos = Math.min(mouseClickX, mouseMoveX);
      this.selectionEndPos = Math.max(mouseClickX, mouseMoveX);

      this.selectionSvg.setAttribute('x', `${this.selectionStartPos}`);
      this.selectionSvg.setAttribute('width', `${this.selectionEndPos - this.selectionStartPos}`);
    } else {
      const mouseMov = e.clientX - this.mouseDownX;
      this.selectionStartPos = this.selectionOffset + mouseMov;
      this.selectionStartPos = Math.min(Math.max(0, this.selectionStartPos), this.width - this.selectionWidth);
      this.selectionEndPos = this.selectionStartPos + this.selectionWidth;
      this.selectionSvg.setAttribute('x', `${this.selectionStartPos}`);
    }
    
    if (this.cbSelectionChange) {
      const selectionStartTime = this.duration * this.selectionStartPos / this.width + this.startTime;
      const selectionEndTime = this.duration * this.selectionEndPos / this.width + this.startTime;
      this.cbSelectionChange(selectionStartTime, selectionEndTime);
    }
  }

  mouseUp(e) {
    if (!this.freeSelection) {
      this.selectionOffset = this.selectionStartPos;
    }
    window.removeEventListener('mousemove', this.mouseMove);
    window.removeEventListener('mouseup', this.mouseUp);
  }


  touchStartTarget(e) {
    e.preventDefault();

    if (this.pointerIds.length === 0) {      
      window.addEventListener('touchmove', this.touchMoveTarget, { passive: false });
      window.addEventListener('touchend', this.touchEndTarget);
      window.addEventListener('touchcancel', this.touchEndTarget);
    }

    for (let touch of e.changedTouches) {
      this.touchDownX = touch.clientX;
      this.touchTargetDim = e.currentTarget.getBoundingClientRect();
      const id = touch.identifier;
      this.pointerIds.push(id);
      this.activePointers.set(id, touch);
    }
  }

  touchMoveTarget(e) {
    e.preventDefault();

    for (let touch of e.changedTouches) {
      const id = touch.identifier;
      if (this.pointerIds.indexOf(id) !== -1) {
        if (this.freeSelection) {
          const touchX = this.touchDownX - this.touchTargetDim.left;
          const touchMoveX = Math.max(0, Math.min(touch.clientX - this.touchTargetDim.left, this.width));
          this.selectionStartPos = Math.min(touchX, touchMoveX);
          this.selectionEndPos = Math.max(touchX, touchMoveX);

          this.selectionSvg.setAttribute('x', `${this.selectionStartPos}`);
          this.selectionSvg.setAttribute('width', `${this.selectionEndPos - this.selectionStartPos}`);
        } else {
          const touchMov = touch.clientX - this.touchDownX;
          this.selectionStartPos = this.selectionOffset + touchMov;
          this.selectionStartPos = Math.min(Math.max(0, this.selectionStartPos), this.width - this.selectionWidth);
          this.selectionEndPos = this.selectionStartPos + this.selectionWidth;
          this.selectionSvg.setAttribute('x', `${this.selectionStartPos}`);
        }

        if (this.cbSelectionChange) {
          const selectionStartTime = this.duration * this.selectionStartPos / this.width + this.startTime;
          const selectionEndTime = this.duration * this.selectionEndPos / this.width + this.startTime;
          this.cbSelectionChange(selectionStartTime, selectionEndTime);
        }
      }
    }
  }

  touchEndTarget(e) {
    for (let touch of e.changedTouches) {
      const pointerId = touch.identifier;
      const index = this.pointerIds.indexOf(pointerId);
      if (index !== -1) {
        this.pointerIds.splice(index, 1);
        this.activePointers.delete(pointerId);
      }
    }

    if (this.pointerIds.length === 0) {
      if (!this.freeSelection) {
        this.selectionOffset = this.selectionStartPos;
      }
      window.removeEventListener('touchmove', this.touchMoveTarget);
      window.removeEventListener('touchend', this.touchEndTarget);
      window.removeEventListener('touchcancel', this.touchEndTarget);
    }
  }


  render() {
    return html`
      ${this.container}
    `
  }
}