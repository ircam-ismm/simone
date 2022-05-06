import '@ircam/simple-components/sc-file-tree.js';
import '@ircam/simple-components/sc-button.js';


export default class Mosaicing extends State {
  constructor(name, context) {
    super(name, context);
  }

  async enter() {

  }

  async exit() {

  }


  render() {
    // debounce with requestAnimationFrame
    window.cancelAnimationFrame(this.rafId);

    const now = this.audioContext.currentTime;

    this.rafId = window.requestAnimationFrame(() => {
      render(html`
        <div style="padding: 20px">
          <h1 style="margin: 20px 0">${this.client.type} [id: ${this.client.id}]</h1>
        </div>

        <div>
          <h3>Source</h3>

          <sc-file-tree
            value="${JSON.stringify(this.soundbankTreeRender)}";
            @input="${e => this.selectSourceFile(this.audioBufferLoader.data[e.detail.value.name])}"
          ></sc-file-tree>

          <div style="
            display: inline;
            position: relative;"
          >
            <svg
              width=${this.waveformWidth}
              height=${this.waveformHeight}
              style="
                background-color: black
              "
            >
              ${this.$wvSvgSource}
              ${this.$cursorSource}
            </svg>

            <sc-button
              style="
                position: absolute;
                bottom: 0;
                left: 0;
              "
              text="start"
              width="100"
              @input="${e => this.playSourceFile()}"
            ></sc-button>
            <sc-button
              style="
                position: absolute;
                bottom: 0;
                left: 105px;
              "
              width="100"
              text="stop"
              @input="${e => this.sourcePlayerNode.stop()}"
            ></sc-button>
          </div>

        </div>

        <div>
            <h3>Target</h3>

            <sc-file-tree
              value="${JSON.stringify(this.soundbankTreeRender)}";
              @input="${e => this.selectTargetFile(this.audioBufferLoader.data[e.detail.value.name])}"
            ></sc-file-tree>

            <div style="
              display: inline;
              position: relative;"
            >
              <svg
                width=${this.waveformWidth}
                height=${this.waveformHeight}
                style="
                  background-color: black
                "
              >
                ${this.$wvSvgTarget}
                ${this.$cursorTarget}
              </svg>

              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 0;
                "
                text="start"
                width="100"
                @input="${e => this.playTargetFile()}"
              ></sc-button>
              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 105px;
                "
                width="100"
                text="stop"
                @input="${e => this.targetPlayerNode.stop()}"
              ></sc-button>
              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 210px;
                "
                width="100"
                text="rec"
                @input="${e => this.mediaRecorder.start()}"
              ></sc-button>
              <sc-button
                style="
                  position: absolute;
                  bottom: 0;
                  left: 315px;
                "
                width="100"
                text="stop rec"
                @input="${e => this.mediaRecorder.stop()}"
              ></sc-button>
            </div>

        </div>

        <div style="margin: 10px">
          <sc-button
            text="start mosaicing"
            @input="${e => this.synth.start()}"
          ></sc-button>
          <sc-button
            text="stop"
            @input="${e => this.synth.stop()}"
          ></sc-button>
        </div>

      `, this.$container);
    });
  }
}

}
