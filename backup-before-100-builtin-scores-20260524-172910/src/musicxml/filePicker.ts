import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { extractMusicXmlFromMxl } from "./mxl";

export async function pickMusicXmlFile() {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    copyToCacheDirectory: true,
  });

  if (result.canceled) return null;

  const file = result.assets[0];
  const name = file.name ?? "Imported score";
  const mimeType = file.mimeType ?? "";
  const isLikelyMxl =
    /\.(mxl|mxl\.zip)$/i.test(name) ||
    mimeType.includes("musicxml") ||
    mimeType.includes("zip") ||
    mimeType.includes("octet-stream");

  let xml = "";

  if (!isLikelyMxl) {
    xml = await FileSystem.readAsStringAsync(file.uri);
  }

  if (!xml.includes("<score-partwise") && !xml.includes("<score-timewise")) {
    xml = await extractMusicXmlFromMxl(
      await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
    );
  }

  return {
    name,
    uri: file.uri,
    xml,
  };
}
