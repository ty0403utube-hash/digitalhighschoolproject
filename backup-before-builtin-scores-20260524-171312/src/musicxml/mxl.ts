import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

type XmlNode = Record<string, any>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isMusicXmlPath(path: string) {
  return /\.(musicxml|xml)$/i.test(path) && !/META-INF\/container\.xml$/i.test(path);
}

export async function extractMusicXmlFromMxl(base64: string) {
  const zip = await JSZip.loadAsync(base64, { base64: true });
  const container = zip.file("META-INF/container.xml");

  if (container) {
    const containerXml = await container.async("text");
    const parser = new XMLParser({ ignoreAttributes: false });
    const doc = parser.parse(containerXml);
    const rootfiles = asArray<XmlNode>(doc.container?.rootfiles?.rootfile);
    const fullPath = rootfiles[0]?.["@_full-path"];

    if (fullPath && zip.file(fullPath)) {
      return zip.file(fullPath)!.async("text");
    }
  }

  const fallbackPath = Object.keys(zip.files).find(isMusicXmlPath);
  if (!fallbackPath) {
    throw new Error("MXL 안에서 MusicXML 파일을 찾지 못했습니다.");
  }

  return zip.file(fallbackPath)!.async("text");
}
