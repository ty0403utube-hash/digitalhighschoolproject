import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Platform, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { OSMD_BUNDLE_BASE64_CHUNKS } from "../webview/osmdBundleBase64";
import { createOsmdPracticeHtml } from "../webview/osmdPracticeHtml";

export type ScoreWebViewHandle = {
  setNoteColor: (index: number, color: string) => void;
  setNoteLabel: (index: number, text: string, color?: string) => void;
  setNoteProgress: (index: number, progress: number) => void;
  resetNoteColors: () => void;
  clearPracticeMarks: () => void;
  scrollToNote: (index: number) => void;
  scrollScorePage: (direction: "prev" | "next") => void;
  startMic: () => void;
  resetScore: () => void;
};

type Props = {
  musicXml: string;
  layoutMode: "page" | "flow";
  measureFrom: number;
  measureTo: number;
  noteIndexOffset: number;
  useLowestChordNoteOnly: boolean;
  onPitch: (payload: { hz: number; clarity: number; rms?: number; isAttack?: boolean }) => void;
  onFftPitchClasses: (payload: { pitchClasses: number[]; peaks: Array<{ hz: number; db: number }> }) => void;
  onScoreReady: (payload?: {
    noteCount?: number;
    height?: number;
    svgCount?: number;
    measureCount?: number;
    measureFrom?: number;
    measureTo?: number;
    renderMode?: string;
    bodyScrollHeight?: number;
    documentScrollHeight?: number;
  }) => void;
  onScoreError: (message: string) => void;
  onNoteMapWarning: (message: string) => void;
  onScrollInfo: (payload: { page: number; totalPages: number }) => void;
  onMicReady: () => void;
  onMicUnavailable: (message: string) => void;
  onNotePress?: (payload: { index: number }) => void;
};

export const ScoreWebView = forwardRef<ScoreWebViewHandle, Props>(
  (
    {
      musicXml,
      layoutMode,
      measureFrom,
      measureTo,
      noteIndexOffset,
      useLowestChordNoteOnly,
      onPitch,
      onFftPitchClasses,
      onScoreReady,
      onScoreError,
      onNoteMapWarning,
      onScrollInfo,
      onMicReady,
      onMicUnavailable,
      onNotePress,
    },
    ref
  ) => {
    const isWebPreview = Platform.OS === "web";
    const webViewRef = useRef<WebView>(null);
    const webViewReadyRef = useRef(false);

    const html = useMemo(
      () =>
        isWebPreview
          ? ""
          : createOsmdPracticeHtml(
              `data:application/javascript;base64,${OSMD_BUNDLE_BASE64_CHUNKS.join("")}`
            ),
      [isWebPreview]
    );

    const send = (type: string, payload?: unknown) => {
      webViewRef.current?.postMessage(JSON.stringify({ type, payload }));
    };

    useEffect(() => {
      if (webViewReadyRef.current) {
        send("LOAD_SCORE", {
          musicXml,
          layoutMode,
          measureFrom,
          measureTo,
          noteIndexOffset,
          useLowestChordNoteOnly,
        });
      }
    }, [musicXml, layoutMode, measureFrom, measureTo, noteIndexOffset, useLowestChordNoteOnly]);

    useEffect(() => {
      if (!isWebPreview) return;
      onScoreReady({
        renderMode: "web-preview",
        measureFrom,
        measureTo,
        noteCount: 0,
        svgCount: 0,
      });
      onScrollInfo({ page: 1, totalPages: 1 });
    }, [isWebPreview, measureFrom, measureTo, onScoreReady, onScrollInfo]);

    useImperativeHandle(ref, () => ({
      setNoteColor(index: number, color: string) {
        send("SET_NOTE_COLOR", { index, color });
      },
      setNoteLabel(index: number, text: string, color?: string) {
        send("SET_NOTE_LABEL", { index, text, color });
      },
      setNoteProgress(index: number, progress: number) {
        send("SET_NOTE_PROGRESS", { index, progress });
      },
      resetNoteColors() {
        send("RESET_NOTE_COLORS");
      },
      clearPracticeMarks() {
        send("CLEAR_PRACTICE_MARKS");
      },
      scrollToNote(index: number) {
        send("SCROLL_TO_NOTE", { index });
      },
      scrollScorePage(direction: "prev" | "next") {
        send("SCROLL_SCORE_PAGE", { direction });
      },
      startMic() {
        if (isWebPreview) {
          onMicUnavailable("Score WebView and microphone judgment are not available in the web preview.");
          return;
        }
        send("START_MIC");
      },
      resetScore() {
        send("RESET_SCORE");
      },
    }));

    if (isWebPreview) {
      const titleMatch = musicXml.match(/<work-title>([^<]+)<\/work-title>/);
      return (
        <View
          style={{
            flex: 1,
            minHeight: 360,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            backgroundColor: "#f7faf8",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#1f3829", textAlign: "center" }}>
            {titleMatch?.[1] ?? "MusicXML score"}
          </Text>
          <Text
            style={{
              marginTop: 10,
              fontSize: 14,
              lineHeight: 21,
              color: "#52645a",
              textAlign: "center",
            }}
          >
            {"Score WebView and microphone judgment are disabled in the web preview.\nUse the web preview for app flow, then test live pitch judgment in Expo on a device."}
          </Text>
        </View>
      );
    }

    return (
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html, baseUrl: "https://localhost/" }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled
        nestedScrollEnabled
        showsVerticalScrollIndicator
        showsHorizontalScrollIndicator
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        allowsInlineMediaPlayback
        onMessage={(event) => {
          let msg: any;

          try {
            msg = JSON.parse(event.nativeEvent.data);
          } catch {
            onScoreError("Ignored invalid WebView message.");
            return;
          }

          if (msg.type === "READY") {
            webViewReadyRef.current = true;
            send("LOAD_SCORE", {
              musicXml,
              layoutMode,
              measureFrom,
              measureTo,
              noteIndexOffset,
              useLowestChordNoteOnly,
            });
          }

          if (msg.type === "SCORE_RENDERED") {
            onScoreReady(msg.payload);
          }

          if (msg.type === "ERROR") {
            onScoreError(msg.payload?.message ?? "Score render failed.");
          }

          if (msg.type === "NOTE_MAP_WARNING") {
            onNoteMapWarning(msg.payload?.message ?? "Could not map rendered notes.");
          }

          if (msg.type === "SCROLL_INFO") {
            onScrollInfo(msg.payload);
          }

          if (msg.type === "PITCH") {
            onPitch(msg.payload);
          }

          if (msg.type === "FFT_PITCH_CLASSES") {
            onFftPitchClasses(msg.payload);
          }

          if (msg.type === "MIC_READY") {
            onMicReady();
          }

          if (msg.type === "MIC_UNAVAILABLE") {
            onMicUnavailable(msg.payload?.message ?? "Microphone is unavailable.");
          }

          if (msg.type === "NOTE_PRESS") {
            onNotePress?.({ index: Number(msg.payload?.index) });
          }
        }}
      />
    );
  }
);

ScoreWebView.displayName = "ScoreWebView";
