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
    let noteLabelMap = new Map();
    let originalColors = new Map();
    let micStarted = false;
    let audioContext;
    let analyser;
    let input;
    let frequencyData;
    let lastFftSentAt = 0;
    let micReadySent = false;
    let smoothedRms = 0;
    let lastOnsetAt = 0;
    let scoreTapHandlersInstalled = false;
    let lastScoreTapSentAt = 0;
    let pressStart = null;
    let pressMoved = false;
    let suppressClickUntil = 0;
    const PITCH_BUFFER_SIZE = 4096;
    const MIN_PITCH_HZ = 45;
    const MAX_PITCH_HZ = 1600;
    const MIN_RMS = 0.0009;
    const MIN_PITCH_CLARITY_TO_SEND = 0.16;
    const MIN_ONSET_RMS = 0.004;
    const ONSET_RATIO = 1.6;
    const ONSET_WINDOW_MS = 160;
    const YIN_THRESHOLD = 0.24;
    const TAP_MOVE_TOLERANCE_PX = 10;
    const TAP_MAX_DURATION_MS = 700;

    function send(type, payload) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
    }

    function beginPress(clientX, clientY) {
      pressStart = { clientX, clientY, at: Date.now() };
      pressMoved = false;
    }

    function updatePress(clientX, clientY) {
      if (!pressStart) return;
      const dx = clientX - pressStart.clientX;
      const dy = clientY - pressStart.clientY;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_TOLERANCE_PX) {
        pressMoved = true;
      }
    }

    function finishPress(clientX, clientY) {
      if (!pressStart) return true;
      updatePress(clientX, clientY);
      const elapsed = Date.now() - pressStart.at;
      const isTap = !pressMoved && elapsed <= TAP_MAX_DURATION_MS;
      if (!isTap) {
        suppressClickUntil = Date.now() + 350;
      }
      pressStart = null;
      pressMoved = false;
      return isTap;
    }

    function shouldIgnoreClick() {
      return Date.now() < suppressClickUntil;
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
      const xmlForPagedScroll = addPageBreaksEveryNMeasures(xmlForRange, 16);
      const xmlForFlow = stripFlowLayoutBreaks(xmlForRange);
      const attempts = [
        {
          label: "range",
          xml: usePageLayout ? xmlForPagedScroll : xmlForFlow,
          usePageLayout
        },
        {
          label: "range-flow",
          xml: xmlForFlow,
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
      noteLabelMap = new Map();
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
        newSystemFromXML: usePageLayout,
        newPageFromXML: usePageLayout,
        renderSingleHorizontalStaffline: false
      });

      await osmd.load(xmlToRender);
      if (usePageLayout && osmd.EngravingRules) {
        osmd.EngravingRules.RenderXMeasuresPerLineAkaSystem = 4;
        osmd.EngravingRules.RenderXMeasuresPerLineAkaSystemForEachLine = 4;
        osmd.EngravingRules.PageTopMargin = 8;
        osmd.EngravingRules.PageBottomMargin = 8;
      }
      osmd.Zoom = 0.9;
      osmd.render();
      try {
        buildNoteMap(noteIndexOffset, useLowestChordNoteOnly);
        aliasRepeatedNoteMap(xmlToRender, noteIndexOffset, useLowestChordNoteOnly);
        createNoteTouchTargets();
        installScoreTapHandlers();
      } catch (error) {
        noteMap = new Map();
        noteLabelMap = new Map();
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

    function addPageBreaksEveryNMeasures(musicXml, interval) {
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const doc = parser.parseFromString(musicXml, "application/xml");
      const parserError = doc.querySelector("parsererror");

      if (parserError) {
        return musicXml;
      }

      const measures = Array.from(doc.querySelectorAll("part > measure"));
      measures.forEach((measure, index) => {
        if (index === 0 || index % interval !== 0) return;

        const print = doc.createElement("print");
        print.setAttribute("new-page", "yes");
        measure.insertBefore(print, measure.firstChild);
      });

      return serializer.serializeToString(doc);
    }

    function stripFlowLayoutBreaks(musicXml) {
      const parser = new DOMParser();
      const serializer = new XMLSerializer();
      const doc = parser.parseFromString(musicXml, "application/xml");
      const parserError = doc.querySelector("parsererror");

      if (parserError) {
        return musicXml;
      }

      for (const printNode of Array.from(doc.querySelectorAll("print"))) {
        printNode.parentNode && printNode.parentNode.removeChild(printNode);
      }

      return serializer.serializeToString(doc);
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

    function parseXmlDocument(musicXml) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(musicXml, "application/xml");
      const parserError = doc.querySelector("parsererror");
      return parserError ? null : doc;
    }

    function buildNoteMap(noteIndexOffset, useLowestChordNoteOnly) {
      const iterator = osmd.Sheet.MusicPartManager.getIterator();
      let index = Number.isFinite(noteIndexOffset) ? noteIndexOffset : 0;

      while (!iterator.EndReached) {
        const entries = iterator.CurrentVoiceEntries || [];
        const notesAtTimestamp = [];

        for (const entry of entries) {
          const notes = entry.Notes || [];
          if (useLowestChordNoteOnly) {
            notesAtTimestamp.push(...notes);
            continue;
          }

          for (const note of notes) {
            const graphicalNote = osmd.rules.GNote(note);
            if (graphicalNote) {
              noteMap.set(String(index), graphicalNote);
              originalColors.set(String(index), "#111111");
              attachNotePressHandler(index, graphicalNote);
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
            attachNotePressHandler(index, graphicalNote);
            index += 1;
          }
        }

        iterator.moveToNext();
      }
    }

    function aliasRepeatedNoteMap(musicXml, noteIndexOffset, useLowestChordNoteOnly) {
      const doc = parseXmlDocument(musicXml);
      if (!doc) return;

      const part = doc.querySelector("part");
      if (!part) return;

      const measures = Array.from(part.childNodes).filter((child) => {
        return child.nodeType === 1 && getNodeName(child) === "measure";
      });
      if (!measures.length || !hasBackwardRepeat(measures)) return;

      const visualSlotsByMeasure = new Map();
      let visualIndex = Number.isFinite(noteIndexOffset) ? noteIndexOffset : 0;

      measures.forEach((measure, measureIndex) => {
        const count = countPlayableNoteSlots(measure, useLowestChordNoteOnly);
        const slots = [];
        for (let offset = 0; offset < count; offset += 1) {
          slots.push(visualIndex + offset);
        }
        visualSlotsByMeasure.set(measureIndex, slots);
        visualIndex += count;
      });

      const expandedMeasureIndices = expandRepeatMeasureIndices(measures);
      let timelineIndex = Number.isFinite(noteIndexOffset) ? noteIndexOffset : 0;

      for (const measureIndex of expandedMeasureIndices) {
        const slots = visualSlotsByMeasure.get(measureIndex) || [];
        for (const sourceIndex of slots) {
          const sourceKey = String(sourceIndex);
          const targetKey = String(timelineIndex);
          const graphicalNote = noteMap.get(sourceKey);

          if (graphicalNote && !noteMap.has(targetKey)) {
            noteMap.set(targetKey, graphicalNote);
            originalColors.set(targetKey, originalColors.get(sourceKey) || "#111111");
          }

          timelineIndex += 1;
        }
      }
    }

    function countPlayableNoteSlots(measure, useLowestChordNoteOnly) {
      let count = 0;

      for (const child of Array.from(measure.childNodes)) {
        if (child.nodeType !== 1 || getNodeName(child) !== "note") continue;

        const hasPitchOrRest = child.querySelector("pitch, rest");
        if (!hasPitchOrRest) continue;

        const isChordTone = child.querySelector("chord") !== null;

        if (useLowestChordNoteOnly) {
          if (!isChordTone) {
            count += 1;
          }
          continue;
        }

        count += 1;
      }

      return count;
    }

    function hasBackwardRepeat(measures) {
      return measures.some((measure) => measureHasRepeatDirection(measure, "backward"));
    }

    function expandRepeatMeasureIndices(measures) {
      const expanded = [];
      let repeatStartIndex = 0;

      for (let index = 0; index < measures.length; index += 1) {
        const measure = measures[index];
        expanded.push(index);

        if (measureHasRepeatDirection(measure, "forward")) {
          repeatStartIndex = index;
        }

        if (measureHasRepeatDirection(measure, "backward")) {
          const times = getBackwardRepeatTimes(measure);
          for (let passNumber = 2; passNumber <= times; passNumber += 1) {
            for (let repeatedIndex = repeatStartIndex; repeatedIndex <= index; repeatedIndex += 1) {
              if (shouldPlayRepeatedMeasure(measures[repeatedIndex], passNumber)) {
                expanded.push(repeatedIndex);
              }
            }
          }
          repeatStartIndex = index + 1;
        }
      }

      return expanded;
    }

    function measureHasRepeatDirection(measure, direction) {
      return Array.from(measure.children).some((child) => {
        if (getNodeName(child) !== "barline") return false;
        const repeat = Array.from(child.children).find((barlineChild) => {
          return getNodeName(barlineChild) === "repeat";
        });
        return repeat ? repeat.getAttribute("direction") === direction : false;
      });
    }

    function getBackwardRepeatTimes(measure) {
      for (const child of Array.from(measure.children)) {
        if (getNodeName(child) !== "barline") continue;
        const repeat = Array.from(child.children).find((barlineChild) => {
          return getNodeName(barlineChild) === "repeat";
        });
        if (repeat && repeat.getAttribute("direction") === "backward") {
          const times = Number(repeat.getAttribute("times") || 2);
          return Number.isFinite(times) && times > 1 ? Math.floor(times) : 2;
        }
      }

      return 2;
    }

    function shouldPlayRepeatedMeasure(measure, passNumber) {
      const endings = getEndingNumbers(measure);
      return endings.size === 0 || endings.has(passNumber);
    }

    function getEndingNumbers(measure) {
      const numbers = new Set();

      for (const child of Array.from(measure.children)) {
        if (getNodeName(child) !== "barline") continue;
        const ending = Array.from(child.children).find((barlineChild) => {
          return getNodeName(barlineChild) === "ending";
        });
        const rawNumber = ending ? ending.getAttribute("number") : "";
        if (!rawNumber) continue;

        rawNumber.split(",").forEach((part) => {
          const value = Number(part.trim());
          if (Number.isFinite(value) && value > 0) {
            numbers.add(Math.floor(value));
          }
        });
      }

      return numbers;
    }

    function attachNotePressHandler(index, graphicalNote) {
      const element = getGraphicalNoteElement(graphicalNote);
      if (!element) return;
      element.style.cursor = "pointer";
      element.style.pointerEvents = "auto";
      element.addEventListener("click", function(event) {
        if (shouldIgnoreClick()) return;
        event.preventDefault();
        event.stopPropagation();
        send("NOTE_PRESS", { index });
      });
    }

    function createNoteTouchTargets() {
      for (const target of Array.from(document.querySelectorAll("[data-note-touch-target]"))) {
        target.parentNode && target.parentNode.removeChild(target);
      }

      for (const [key, note] of noteMap.entries()) {
        const index = Number(key);
        const element = getGraphicalNoteElement(note);
        const anchor = getNoteAnchor(note);
        const svg = (element && element.ownerSVGElement) || (anchor && anchor.svg);
        if (!svg) continue;

        let x = anchor ? anchor.x : 0;
        let y = anchor ? anchor.y : 0;
        let width = 28;
        let height = 34;

        if (element && typeof element.getBBox === "function") {
          try {
            const box = element.getBBox();
            x = box.x + box.width / 2;
            y = box.y + box.height / 2;
            width = Math.max(28, box.width + 22);
            height = Math.max(34, box.height + 24);
          } catch (error) {
            // Use anchor fallback.
          }
        }

        const hit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        hit.setAttribute("data-note-touch-target", key);
        hit.setAttribute("x", String(x - width / 2));
        hit.setAttribute("y", String(y - height / 2));
        hit.setAttribute("width", String(width));
        hit.setAttribute("height", String(height));
        hit.setAttribute("rx", "6");
        hit.setAttribute("fill", "transparent");
        hit.setAttribute("fill-opacity", "0");
        hit.setAttribute("stroke", "none");
        hit.setAttribute("pointer-events", "all");
        hit.style.cursor = "pointer";
        hit.addEventListener("click", function(event) {
          if (shouldIgnoreClick()) return;
          event.preventDefault();
          event.stopPropagation();
          send("NOTE_PRESS", { index });
        });
        hit.addEventListener("touchstart", function(event) {
          const touch = event.touches && event.touches[0];
          if (!touch) return;
          beginPress(touch.clientX, touch.clientY);
        }, { passive: true });
        hit.addEventListener("touchmove", function(event) {
          const touch = event.touches && event.touches[0];
          if (!touch) return;
          updatePress(touch.clientX, touch.clientY);
        }, { passive: true });
        hit.addEventListener("touchend", function(event) {
          if (shouldIgnoreClick()) {
            event.stopPropagation();
            return;
          }
          const touch = event.changedTouches && event.changedTouches[0];
          if (touch && !finishPress(touch.clientX, touch.clientY)) {
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          suppressClickUntil = Date.now() + 350;
          send("NOTE_PRESS", { index });
        });
        svg.appendChild(hit);
      }
    }

    function installScoreTapHandlers() {
      if (scoreTapHandlersInstalled) return;
      scoreTapHandlersInstalled = true;
      const score = document.getElementById("score");
      if (!score) return;

      function handlePoint(clientX, clientY) {
        const now = Date.now();
        if (shouldIgnoreClick()) return;
        if (now - lastScoreTapSentAt < 180) return;

        const nearest = findNearestNoteToClientPoint(clientX, clientY);
        if (!nearest) return;

        lastScoreTapSentAt = now;
        send("NOTE_PRESS", { index: nearest.index });
      }

      score.addEventListener("click", function(event) {
        if (shouldIgnoreClick()) return;
        handlePoint(event.clientX, event.clientY);
      });

      score.addEventListener("mousedown", function(event) {
        beginPress(event.clientX, event.clientY);
      });

      score.addEventListener("mousemove", function(event) {
        updatePress(event.clientX, event.clientY);
      });

      score.addEventListener("mouseup", function(event) {
        finishPress(event.clientX, event.clientY);
      });

      score.addEventListener("touchstart", function(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        beginPress(touch.clientX, touch.clientY);
      }, { passive: true });

      score.addEventListener("touchmove", function(event) {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        updatePress(touch.clientX, touch.clientY);
      }, { passive: true });

      score.addEventListener("touchend", function(event) {
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        if (!finishPress(touch.clientX, touch.clientY)) return;
        handlePoint(touch.clientX, touch.clientY);
      }, { passive: true });
    }

    function findNearestNoteToClientPoint(clientX, clientY) {
      let best = null;
      for (const [key, note] of noteMap.entries()) {
        const element = getGraphicalNoteElement(note);
        if (!element || typeof element.getBoundingClientRect !== "function") continue;

        try {
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const distance = Math.hypot(centerX - clientX, centerY - clientY);
          if (!best || distance < best.distance) {
            best = { index: Number(key), distance };
          }
        } catch (error) {
          // Ignore notes without measurable SVG bounds.
        }
      }

      if (!best || best.distance > 72) {
        return null;
      }

      return best;
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

    function setNoteLabel(index, text, color) {
      const note = noteMap.get(String(index));
      const anchor = getNoteAnchor(note);
      if (!anchor || !anchor.svg) return;

      if (!text) {
        const key = String(index);
        const existing = noteLabelMap.get(key);
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
        noteLabelMap.delete(key);
        return;
      }

      const svg = anchor.svg;
      const key = String(index);
      const existing = noteLabelMap.get(key);
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("data-practice-label", key);
      group.setAttribute("pointer-events", "none");

      const labelText = document.createElementNS("http://www.w3.org/2000/svg", "text");
      labelText.setAttribute("x", String(anchor.x));
      labelText.setAttribute("y", String(anchor.y - 4));
      labelText.setAttribute("text-anchor", "middle");
      labelText.setAttribute("font-size", "10");
      labelText.setAttribute("font-weight", "900");
      labelText.setAttribute("font-family", "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif");
      labelText.setAttribute("fill", color || "#1f2a25");
      labelText.setAttribute("paint-order", "stroke");
      labelText.setAttribute("stroke", "#ffffff");
      labelText.setAttribute("stroke-width", "3");
      labelText.setAttribute("stroke-linejoin", "round");
      labelText.textContent = text;

      group.appendChild(labelText);
      svg.appendChild(group);
      noteLabelMap.set(key, group);
    }

    function getNoteAnchor(note) {
      const element = getGraphicalNoteElement(note);
      if (element && element.ownerSVGElement) {
        try {
          const box = element.getBBox();
          if (
            !Number.isFinite(box.x) ||
            !Number.isFinite(box.y) ||
            (Math.abs(box.x) < 1 && Math.abs(box.y) < 1 && box.width <= 1 && box.height <= 1)
          ) {
            return null;
          }
          return {
            svg: element.ownerSVGElement,
            x: box.x + box.width / 2,
            y: box.y
          };
        } catch (error) {
          return null;
        }
      }

      return null;
    }

    function getGraphicalNoteElement(note) {
      if (!note) return null;
      const candidates = [
        typeof note.getSVGGElement === "function" ? note.getSVGGElement() : null,
        note.SVGGElement,
        note.svgElement,
        note.element,
        note.Node
      ];

      for (const candidate of candidates) {
        if (candidate && candidate.ownerSVGElement && typeof candidate.getBBox === "function") {
          return candidate;
        }
      }

      return null;
    }

    function getScoreSvg() {
      return document.querySelector("#score svg");
    }

    function scrollToNote(index) {
      const note = noteMap.get(String(index));
      const element = getGraphicalNoteElement(note);

      if (element && typeof element.getBoundingClientRect === "function") {
        const rect = element.getBoundingClientRect();
        const comfortableTop = window.innerHeight * 0.24;
        const comfortableBottom = window.innerHeight * 0.78;
        if (rect.top >= comfortableTop && rect.bottom <= comfortableBottom) {
          return;
        }

        const targetTop = window.scrollY + rect.top - window.innerHeight * 0.32;
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo({
          top: Math.max(0, Math.min(maxScroll, targetTop)),
          behavior: "smooth"
        });
        return;
      }

      const anchor = getNoteAnchor(note);
      if (!anchor || !anchor.svg) return;

      const svgRect = anchor.svg.getBoundingClientRect();
      const viewBox = anchor.svg.viewBox && anchor.svg.viewBox.baseVal;
      const scaleY = viewBox && viewBox.height ? svgRect.height / viewBox.height : 1;
      const noteTop = svgRect.top + anchor.y * scaleY;
      const comfortableTop = window.innerHeight * 0.24;
      const comfortableBottom = window.innerHeight * 0.78;
      if (noteTop >= comfortableTop && noteTop <= comfortableBottom) {
        return;
      }

      const targetTop = window.scrollY + noteTop - window.innerHeight * 0.32;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({
        top: Math.max(0, Math.min(maxScroll, targetTop)),
        behavior: "smooth"
      });
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
      const note = noteMap.get(String(index));
      const element = getGraphicalNoteElement(note);
      const svg = element && element.ownerSVGElement;
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
      for (const [, label] of noteLabelMap.entries()) {
        if (label && label.parentNode) {
          label.parentNode.removeChild(label);
        }
      }
      noteLabelMap = new Map();
    }

    function resetNoteColors() {
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
        analyser.fftSize = PITCH_BUFFER_SIZE;
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
      const rms = getRms(input);
      const now = Date.now();
      const isOnset = updateOnsetState(rms, now);
      const result = detectPitchYin(input, audioContext.sampleRate, rms);
      const hz = result.hz;
      const clarity = result.clarity;

      if (
        clarity > MIN_PITCH_CLARITY_TO_SEND &&
        hz > MIN_PITCH_HZ &&
        hz < MAX_PITCH_HZ
      ) {
        send("PITCH", { hz, clarity, rms, isAttack: isOnset });
      }

      detectFftPitchClasses();

      requestAnimationFrame(detectLoop);
    }

    function getRms(buffer) {
      let rms = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        rms += buffer[i] * buffer[i];
      }
      return Math.sqrt(rms / buffer.length);
    }

    function updateOnsetState(rms, now) {
      const baseline = smoothedRms || rms;
      const isOnset =
        rms > MIN_ONSET_RMS &&
        rms > baseline * ONSET_RATIO &&
        now - lastOnsetAt > ONSET_WINDOW_MS;

      smoothedRms = baseline * 0.92 + rms * 0.08;
      if (isOnset) {
        lastOnsetAt = now;
      }

      return now - lastOnsetAt <= ONSET_WINDOW_MS;
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

    function detectPitchYin(buffer, sampleRate, rms) {
      if (rms < MIN_RMS) {
        return { hz: 0, clarity: 0 };
      }

      const minTau = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ));
      const maxTau = Math.min(Math.floor(sampleRate / MIN_PITCH_HZ), Math.floor(buffer.length / 2) - 1);
      const yinBuffer = new Float32Array(maxTau + 1);

      for (let tau = 1; tau <= maxTau; tau += 1) {
        let sum = 0;
        for (let i = 0; i < buffer.length - tau; i += 1) {
          const delta = buffer[i] - buffer[i + tau];
          sum += delta * delta;
        }
        yinBuffer[tau] = sum;
      }

      let runningSum = 0;
      yinBuffer[0] = 1;
      for (let tau = 1; tau <= maxTau; tau += 1) {
        runningSum += yinBuffer[tau];
        yinBuffer[tau] = runningSum > 0 ? (yinBuffer[tau] * tau) / runningSum : 1;
      }

      let bestTau = -1;
      for (let tau = minTau; tau <= maxTau; tau += 1) {
        if (yinBuffer[tau] < YIN_THRESHOLD) {
          while (tau + 1 <= maxTau && yinBuffer[tau + 1] < yinBuffer[tau]) {
            tau += 1;
          }
          bestTau = tau;
          break;
        }
      }

      if (bestTau < 0) {
        let bestValue = 1;
        for (let tau = minTau; tau <= maxTau; tau += 1) {
          if (yinBuffer[tau] < bestValue) {
            bestValue = yinBuffer[tau];
            bestTau = tau;
          }
        }

        if (bestTau < 0 || bestValue > 0.42) {
          return { hz: 0, clarity: Math.max(0, 1 - bestValue) };
        }
      }

      const refinedTau = refineTau(yinBuffer, bestTau);
      return {
        hz: sampleRate / refinedTau,
        clarity: Math.max(0, Math.min(1, 1 - yinBuffer[bestTau]))
      };
    }

    function refineTau(yinBuffer, tau) {
      if (tau <= 1 || tau >= yinBuffer.length - 1) return tau;
      const previous = yinBuffer[tau - 1];
      const current = yinBuffer[tau];
      const next = yinBuffer[tau + 1];
      const divisor = 2 * (2 * current - previous - next);
      if (!Number.isFinite(divisor) || Math.abs(divisor) < 0.000001) return tau;
      return tau + (next - previous) / divisor;
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

        if (msg.type === "SET_NOTE_LABEL") {
          setNoteLabel(msg.payload.index, msg.payload.text, msg.payload.color);
        }

        if (msg.type === "SET_NOTE_PROGRESS") {
          setNoteProgress(msg.payload.index, msg.payload.progress);
        }

        if (msg.type === "SCROLL_TO_NOTE") {
          scrollToNote(msg.payload.index);
        }

        if (msg.type === "RESET_SCORE") {
          resetScore();
        }

        if (msg.type === "RESET_NOTE_COLORS") {
          resetNoteColors();
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
