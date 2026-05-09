export function createOsmdPracticeHtml(osmdScriptUri: string) {
  return `
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 100%;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #score {
      width: 100%;
      min-height: 100%;
      box-sizing: border-box;
      padding: 12px 8px 24px;
      overflow: visible;
    }

    #score svg {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }

    #error {
      display: none;
      padding: 16px;
      color: #b3261e;
      font-weight: 700;
    }
  </style>
  <script>
    window.__OSMD_LOADED__ = false;
  </script>
  <script src="${osmdScriptUri}" onload="window.__OSMD_LOADED__ = true" onerror="window.__OSMD_LOAD_ERROR__ = true"></script>
</head>
<body>
  <div id="error"></div>
  <div id="score"></div>

  <script>
    let osmd;
    let noteMap = new Map();
    let originalColors = new Map();
    let micStarted = false;
    let audioContext;
    let analyser;
    let input;
    let frequencyData;
    let lastFftSentAt = 0;
    let micReadySent = false;

    function send(type, payload) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
    }

    function showError(error) {
      const node = document.getElementById("error");
      node.style.display = "none";
      node.textContent = error && error.message ? error.message : String(error);
      send("ERROR", { message: node.textContent });
    }

    async function loadScore(
      musicXml,
      layoutMode,
      measureFrom,
      measureTo,
      noteIndexOffset,
      useLowestChordNoteOnly
    ) {
      if (window.__OSMD_LOAD_ERROR__) {
        throw new Error("OSMD asset script failed to load.");
      }

      if (!window.opensheetmusicdisplay) {
        throw new Error("OSMD is not available in WebView. The local asset may be blocked by this WebView.");
      }

      const usePageLayout = layoutMode !== "flow";
      const xmlForRange = sliceMusicXmlByMeasureRange(musicXml, measureFrom, measureTo);
      const attempts = [
        {
          label: "range",
          xml: xmlForRange,
          usePageLayout
        },
        {
          label: "range-flow",
          xml: xmlForRange,
          usePageLayout: false
        },
        {
          label: "full-flow-fallback",
          xml: musicXml,
          usePageLayout: false
        }
      ];

      let lastError = null;

      for (const attempt of attempts) {
        try {
          await renderScoreAttempt(
            attempt.xml,
            musicXml,
            attempt.usePageLayout,
            measureFrom,
            measureTo,
            noteIndexOffset,
            useLowestChordNoteOnly,
            attempt.label
          );
          return;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error("Unknown OSMD render failure.");
    }

    async function renderScoreAttempt(
      xmlToRender,
      originalXml,
      usePageLayout,
      measureFrom,
      measureTo,
      noteIndexOffset,
      useLowestChordNoteOnly,
      renderMode
    ) {
      document.getElementById("error").style.display = "none";
      document.getElementById("score").innerHTML = "";
      noteMap = new Map();
      originalColors = new Map();

      osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("score", {
        backend: "svg",
        autoResize: true,
        drawTitle: false,
        drawCredits: false,
        drawPartNames: false,
        drawPartAbbreviations: false,
        drawMeasureNumbers: false,
        drawingParameters: usePageLayout ? "compact" : "compacttight",
        pageFormat: usePageLayout ? "A4_P" : "Endless",
        newSystemFromXML: true,
        newPageFromXML: true,
        renderSingleHorizontalStaffline: false
      });

      await osmd.load(xmlToRender);
      osmd.Zoom = 0.9;
      osmd.render();
      try {
        buildNoteMap(noteIndexOffset, useLowestChordNoteOnly);
      } catch (error) {
        noteMap = new Map();
        originalColors = new Map();
        send("NOTE_MAP_WARNING", {
          message: error && error.message ? error.message : String(error)
        });
      }
      window.scrollTo(0, 0);
      updateDocumentHeight();
      const height = getScoreHeight();
      const score = document.getElementById("score");
      const measureCount = countMeasures(originalXml);
      send("SCORE_RENDERED", {
        noteCount: noteMap.size,
        measureCount,
        measureFrom,
        measureTo,
        renderMode,
        height,
        svgCount: document.querySelectorAll("#score svg").length,
        bodyScrollHeight: document.body.scrollHeight,
        documentScrollHeight: document.documentElement.scrollHeight,
        scoreScrollHeight: score ? score.scrollHeight : 0
      });
      sendScrollInfo();
    }

    function countMeasures(musicXml) {
      const matches = musicXml.match(/<measure\\b/g);
      return matches ? matches.length : 0;
    }

    function sliceMusicXmlByMeasureRange(musicXml, measureFrom, measureTo) {
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const doc = parser.parseFromString(musicXml, "application/xml");
      const parserError = doc.querySelector("parsererror");

      if (parserError) {
        return musicXml;
      }

      const parts = Array.from(doc.querySelectorAll("part"));
      for (const part of parts) {
        const measures = Array.from(part.childNodes).filter((child) => {
          return child.nodeType === 1 && getNodeName(child) === "measure";
        });
        let fallbackIndex = 1;
        let latestAttributes = null;
        let firstKeptMeasure = null;

        for (const measure of measures) {
          const attributes = Array.from(measure.childNodes).find((child) => {
            return child.nodeType === 1 && getNodeName(child) === "attributes";
          });
          const rawNumber = measure.getAttribute("number");
          const parsedNumber = rawNumber ? parseInt(rawNumber, 10) : fallbackIndex;
          const measureNumber = Number.isFinite(parsedNumber) ? parsedNumber : fallbackIndex;
          fallbackIndex += 1;

          if (measureNumber < measureFrom || measureNumber > measureTo) {
            if (attributes && measureNumber < measureFrom) {
              latestAttributes = attributes.cloneNode(true);
            }
            part.removeChild(measure);
          } else if (!firstKeptMeasure) {
            firstKeptMeasure = measure;
          }
        }

        if (firstKeptMeasure && latestAttributes) {
          const hasAttributes = Array.from(firstKeptMeasure.childNodes).some((child) => {
            return child.nodeType === 1 && getNodeName(child) === "attributes";
          });

          if (!hasAttributes) {
            firstKeptMeasure.insertBefore(latestAttributes, firstKeptMeasure.firstChild);
          }
        }
      }

      return serializer.serializeToString(doc);
    }

    function getNodeName(node) {
      return node.localName || node.nodeName;
    }

    function buildNoteMap(noteIndexOffset, useLowestChordNoteOnly) {
      const iterator = osmd.Sheet.MusicPartManager.getIterator();
      let index = Number.isFinite(noteIndexOffset) ? noteIndexOffset : 0;

      while (!iterator.EndReached) {
        const entries = iterator.CurrentVoiceEntries || [];
        const notesAtTimestamp = [];

        for (const entry of entries) {
          const notes = (entry.Notes || []).filter((note) => !(note.isRest && note.isRest()));
          if (useLowestChordNoteOnly) {
            notesAtTimestamp.push(...notes);
            continue;
          }

          for (const note of notes) {
            const graphicalNote = osmd.rules.GNote(note);
            if (graphicalNote) {
              noteMap.set(String(index), graphicalNote);
              originalColors.set(String(index), "#111111");
              index += 1;
            }
          }
        }

        if (useLowestChordNoteOnly && notesAtTimestamp.length) {
          const graphicalNotes = notesAtTimestamp
            .map((note) => ({ note, graphicalNote: osmd.rules.GNote(note) }))
            .filter((entry) => entry.graphicalNote);
          const selected = graphicalNotes.length
            ? graphicalNotes.reduce((lowest, entry) => {
                return getGraphicalY(entry.graphicalNote) > getGraphicalY(lowest.graphicalNote)
                  ? entry
                  : lowest;
              }, graphicalNotes[0])
            : { note: notesAtTimestamp[0], graphicalNote: null };
          const graphicalNote =
            selected.graphicalNote ||
            osmd.rules.GNote(
              notesAtTimestamp.reduce((lowest, note) => {
                return getNoteSortValue(note) < getNoteSortValue(lowest) ? note : lowest;
              }, notesAtTimestamp[0])
            );

          if (graphicalNote) {
            noteMap.set(String(index), graphicalNote);
            originalColors.set(String(index), "#111111");
            index += 1;
          }
        }

        iterator.moveToNext();
      }
    }

    function getGraphicalY(graphicalNote) {
      const positionAndShape = graphicalNote && graphicalNote.PositionAndShape;
      const absolutePosition = positionAndShape && positionAndShape.AbsolutePosition;
      const relativePosition = positionAndShape && positionAndShape.RelativePosition;

      if (absolutePosition && Number.isFinite(absolutePosition.y)) {
        return absolutePosition.y;
      }

      if (relativePosition && Number.isFinite(relativePosition.y)) {
        return relativePosition.y;
      }

      if (Number.isFinite(graphicalNote.lineShift)) {
        return graphicalNote.lineShift;
      }

      if (Number.isFinite(graphicalNote.staffLine)) {
        return graphicalNote.staffLine;
      }

      return -Number.MAX_SAFE_INTEGER;
    }

    function getNoteSortValue(note) {
      if (Number.isFinite(note.halfTone)) {
        return note.halfTone;
      }

      const pitch = note.Pitch || note.pitch;
      if (!pitch) {
        return Number.MAX_SAFE_INTEGER;
      }

      if (typeof pitch.getHalfTone === "function") {
        return pitch.getHalfTone();
      }

      const octave = Number(pitch.Octave ?? pitch.octave ?? 0);
      const fundamental = Number(pitch.FundamentalNote ?? pitch.fundamentalNote ?? 0);
      const accidental = Number(pitch.AccidentalHalfTones ?? 0);
      return octave * 12 + fundamental + accidental;
    }

    function setNoteColor(index, color) {
      const note = noteMap.get(String(index));
      if (!note) return;

      note.setColor(color, {
        applyToNotehead: true,
        applyToStem: true,
        applyToBeams: true,
        applyToLedgerLines: true,
        applyToAccidentals: true,
        applyToDots: true
      });
    }

    function getScoreSvg() {
      return document.querySelector("#score svg");
    }

    function getScoreHeight() {
      const score = document.getElementById("score");
      if (!score) return 0;

      const rectHeight = score.getBoundingClientRect().height;
      const scrollHeight = score.scrollHeight;
      const svgHeights = Array.from(score.querySelectorAll("svg")).reduce((sum, svg) => {
        return sum + svg.getBoundingClientRect().height;
      }, 0);

      return Math.ceil(Math.max(rectHeight, scrollHeight, svgHeights));
    }

    function updateDocumentHeight() {
      const height = getScoreHeight();
      const documentHeight = Math.max(height, window.innerHeight + 1);
      document.body.style.height = documentHeight + "px";
      document.documentElement.style.height = documentHeight + "px";
    }

    function ensureDefs(svg) {
      let defs = svg.querySelector("defs");
      if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        svg.insertBefore(defs, svg.firstChild);
      }
      return defs;
    }

    function setNoteProgress(index, progress) {
      const svg = getScoreSvg();
      if (!svg) return;

      const p = Math.max(0, Math.min(1, Number(progress) || 0));
      const id = "note-progress-" + String(index).replace(/[^a-zA-Z0-9_-]/g, "");
      const defs = ensureDefs(svg);
      let gradient = defs.querySelector("#" + id);

      if (!gradient) {
        gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
        gradient.setAttribute("id", id);
        gradient.setAttribute("x1", "0%");
        gradient.setAttribute("y1", "0%");
        gradient.setAttribute("x2", "100%");
        gradient.setAttribute("y2", "0%");
        gradient.setAttribute("gradientUnits", "objectBoundingBox");

        for (let i = 0; i < 4; i += 1) {
          gradient.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "stop"));
        }

        defs.appendChild(gradient);
      }

      const stops = gradient.querySelectorAll("stop");
      const offset = Math.round(p * 100) + "%";
      stops[0].setAttribute("offset", "0%");
      stops[0].setAttribute("stop-color", "#2e7d32");
      stops[1].setAttribute("offset", offset);
      stops[1].setAttribute("stop-color", "#2e7d32");
      stops[2].setAttribute("offset", offset);
      stops[2].setAttribute("stop-color", "#8a8f98");
      stops[3].setAttribute("offset", "100%");
      stops[3].setAttribute("stop-color", "#8a8f98");

      setNoteColor(index, "url(#" + id + ")");
    }

    function resetScore() {
      for (const [index, color] of originalColors.entries()) {
        setNoteColor(index, color);
      }
    }

    function sendScrollInfo() {
      updateDocumentHeight();
      const scoreHeight = getScoreHeight();
      const maxScroll = Math.max(0, scoreHeight - window.innerHeight);
      const pageHeight = Math.max(1, window.innerHeight * 0.92);
      const totalPages = Math.max(1, Math.ceil((maxScroll + 1) / pageHeight));
      const page = Math.min(totalPages, Math.floor(window.scrollY / pageHeight) + 1);
      send("SCROLL_INFO", { page, totalPages });
    }

    function scrollScorePage(direction) {
      const pageHeight = window.innerHeight * 0.92;
      const scoreHeight = getScoreHeight();
      const maxScroll = Math.max(0, scoreHeight - window.innerHeight);
      const currentPage = Math.floor(window.scrollY / pageHeight);
      const nextPage = direction === "prev" ? currentPage - 1 : currentPage + 1;
      const nextY = Math.max(0, Math.min(maxScroll, nextPage * pageHeight));
      window.scrollTo({ top: nextY, behavior: "smooth" });
      window.setTimeout(sendScrollInfo, 350);
    }

    async function startMic() {
      try {
        if (micStarted) {
          send("MIC_READY");
          return;
        }
        micStarted = true;

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (typeof navigator === "undefined") {
          micStarted = false;
          send("MIC_UNAVAILABLE", {
            message: "navigator is unavailable in this WebView."
          });
          return;
        }

        const getUserMedia =
          navigator.mediaDevices && navigator.mediaDevices.getUserMedia
            ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
            : navigator.getUserMedia
              ? navigator.getUserMedia.bind(navigator)
              : navigator.webkitGetUserMedia
                ? navigator.webkitGetUserMedia.bind(navigator)
                : navigator.mozGetUserMedia
                  ? navigator.mozGetUserMedia.bind(navigator)
                  : null;

        if (!AudioContextClass || !getUserMedia) {
          micStarted = false;
          send("MIC_UNAVAILABLE", {
            message: "This WebView cannot access getUserMedia. Use a development build or a secure hosted WebView page for live pitch detection."
          });
          return;
        }

        audioContext = new AudioContextClass();
        if (audioContext.state === "suspended" && audioContext.resume) {
          await audioContext.resume();
        }

        const preferredConstraints = {
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        };
        const simpleConstraints = { audio: true };

        async function requestMicStream(constraints) {
          return await new Promise((resolve, reject) => {
            const result = getUserMedia(constraints, resolve, reject);
            if (result && typeof result.then === "function") {
              result.then(resolve).catch(reject);
            }
          });
        }

        let stream;
        try {
          stream = await requestMicStream(preferredConstraints);
        } catch {
          stream = await requestMicStream(simpleConstraints);
        }

        if (audioContext.state === "suspended" && audioContext.resume) {
          await audioContext.resume();
        }

        const tracks = stream && stream.getAudioTracks ? stream.getAudioTracks() : [];
        if (!tracks.length) {
          micStarted = false;
          send("MIC_UNAVAILABLE", {
            message: "No audio track was returned by the microphone."
          });
          return;
        }

        tracks.forEach((track) => {
          if (track.enabled !== undefined) {
            track.enabled = true;
          }
        });

        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);

        input = new Float32Array(analyser.fftSize);
        frequencyData = new Float32Array(analyser.frequencyBinCount);
        if (!micReadySent) {
          micReadySent = true;
          send("MIC_READY");
        }
        detectLoop();
      } catch (error) {
        micStarted = false;
        send("MIC_UNAVAILABLE", {
          message: error && error.message ? error.message : String(error)
        });
      }
    }

    function detectLoop() {
      if (!analyser || !input || !audioContext) return;

      analyser.getFloatTimeDomainData(input);
      const result = autoCorrelate(input, audioContext.sampleRate);
      const hz = result.hz;
      const clarity = result.clarity;

      if (clarity > 0.3 && hz > 45 && hz < 1600) {
        send("PITCH", { hz, clarity });
      }

      detectFftPitchClasses();

      requestAnimationFrame(detectLoop);
    }

    function detectFftPitchClasses() {
      if (!frequencyData || !audioContext) return;

      const now = Date.now();
      if (now - lastFftSentAt < 120) return;
      lastFftSentAt = now;

      analyser.getFloatFrequencyData(frequencyData);

      const binHz = audioContext.sampleRate / analyser.fftSize;
      const peaks = [];
      const pitchClassScores = new Map();

      for (let midi = 28; midi <= 88; midi += 1) {
        const hz = 440 * Math.pow(2, (midi - 69) / 12);
        const db = getEnergyNearHz(hz, binHz);

        if (db < -78) continue;

        const noiseDb = getLocalNoiseFloor(hz, binHz);
        if (db - noiseDb < 8) continue;

        const pitchClass = ((midi % 12) + 12) % 12;
        const previous = pitchClassScores.get(pitchClass);

        if (!previous || db > previous.db) {
          pitchClassScores.set(pitchClass, { hz, db });
        }
      }

      for (const [pitchClass, peak] of pitchClassScores.entries()) {
        peaks.push({ pitchClass, hz: peak.hz, db: peak.db });
      }

      peaks.sort((a, b) => b.db - a.db);
      const strongest = peaks.slice(0, 6);

      if (strongest.length) {
        send("FFT_PITCH_CLASSES", {
          pitchClasses: strongest.map((peak) => peak.pitchClass),
          peaks: strongest.map((peak) => ({
            hz: Math.round(peak.hz * 10) / 10,
            db: Math.round(peak.db * 10) / 10
          }))
        });
      }
    }

    function getEnergyNearHz(hz, binHz) {
      const centerBin = Math.round(hz / binHz);
      let best = -Infinity;

      for (let offset = -2; offset <= 2; offset += 1) {
        const bin = centerBin + offset;
        if (bin >= 0 && bin < frequencyData.length) {
          best = Math.max(best, frequencyData[bin]);
        }
      }

      return best;
    }

    function getLocalNoiseFloor(hz, binHz) {
      const centerBin = Math.round(hz / binHz);
      let sum = 0;
      let count = 0;

      for (let offset = -18; offset <= 18; offset += 1) {
        if (Math.abs(offset) <= 3) continue;

        const bin = centerBin + offset;
        if (bin >= 0 && bin < frequencyData.length) {
          sum += frequencyData[bin];
          count += 1;
        }
      }

      return count ? sum / count : -100;
    }

    function autoCorrelate(buffer, sampleRate) {
      let rms = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        rms += buffer[i] * buffer[i];
      }
      rms = Math.sqrt(rms / buffer.length);

      if (rms < 0.0015) {
        return { hz: 0, clarity: 0 };
      }

      let bestOffset = -1;
      let bestCorrelation = 0;
      const minOffset = Math.floor(sampleRate / 1600);
      const maxOffset = Math.min(Math.floor(sampleRate / 45), Math.floor(buffer.length / 2));

      for (let offset = minOffset; offset <= maxOffset; offset += 1) {
        let correlation = 0;
        for (let i = 0; i < buffer.length - offset; i += 1) {
          correlation += 1 - Math.abs(buffer[i] - buffer[i + offset]);
        }
        correlation /= buffer.length - offset;

        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = offset;
        }
      }

      if (bestOffset <= 0 || bestCorrelation < 0.3) {
        return { hz: 0, clarity: bestCorrelation };
      }

      return {
        hz: sampleRate / bestOffset,
        clarity: bestCorrelation
      };
    }

    async function handleNativeMessage(event) {
      try {
        if (!event.data || typeof event.data !== "string") {
          return;
        }

        const raw = event.data.trim();
        if (!raw || raw[0] !== "{") {
          return;
        }

        const msg = JSON.parse(raw);

        if (msg.type === "LOAD_SCORE") {
          await loadScore(
            msg.payload.musicXml,
            msg.payload.layoutMode,
            msg.payload.measureFrom,
            msg.payload.measureTo,
            msg.payload.noteIndexOffset,
            msg.payload.useLowestChordNoteOnly
          );
        }

        if (msg.type === "SET_NOTE_COLOR") {
          setNoteColor(msg.payload.index, msg.payload.color);
        }

        if (msg.type === "SET_NOTE_PROGRESS") {
          setNoteProgress(msg.payload.index, msg.payload.progress);
        }

        if (msg.type === "RESET_SCORE") {
          resetScore();
        }

        if (msg.type === "SCROLL_SCORE_PAGE") {
          scrollScorePage(msg.payload.direction);
        }

      } catch (error) {
        showError(error);
      }

      try {
        const raw = event.data && typeof event.data === "string" ? event.data.trim() : "";
        if (!raw || raw[0] !== "{") {
          return;
        }

        const msg = JSON.parse(raw);
        if (msg.type === "START_MIC") {
          await startMic();
        }
      } catch (error) {
        send("MIC_UNAVAILABLE", {
          message: error && error.message ? error.message : String(error)
        });
      }
    }

    window.addEventListener("message", handleNativeMessage);
    document.addEventListener("message", handleNativeMessage);
    window.addEventListener("scroll", sendScrollInfo, { passive: true });
    window.addEventListener("resize", sendScrollInfo);

    send("READY");
  </script>
</body>
</html>
`;
}
