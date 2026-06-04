import { getDownloadURL, getStorage, ref, uploadString } from "firebase/storage";
import { getFirebaseApp } from "./firebaseApp";

export async function uploadMusicXml(params: {
  uid: string;
  songId: string;
  xml: string;
}) {
  const storage = getStorage(getFirebaseApp());
  const storagePath = `users/${params.uid}/musicxml/${params.songId}.musicxml`;
  const fileRef = ref(storage, storagePath);

  await uploadString(fileRef, params.xml, "raw", {
    contentType: "application/vnd.recordare.musicxml+xml",
  });

  return {
    storagePath,
    downloadUrl: await getDownloadURL(fileRef),
  };
}
