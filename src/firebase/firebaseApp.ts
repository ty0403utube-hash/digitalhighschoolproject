import { FirebaseApp, FirebaseOptions, getApps, initializeApp } from "firebase/app";

type FirebaseConfigKey = keyof typeof firebaseConfig;

export class FirebaseConfigError extends Error {
  missingKeys: FirebaseConfigKey[];

  constructor(missingKeys: FirebaseConfigKey[]) {
    super(
      `Firebase configuration is missing: ${missingKeys
        .map((key) => firebaseEnvNames[key])
        .join(", ")}`
    );
    this.name = "FirebaseConfigError";
    this.missingKeys = missingKeys;
  }
}

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const firebaseEnvNames: Record<FirebaseConfigKey, string> = {
  apiKey: "EXPO_PUBLIC_FIREBASE_API_KEY",
  authDomain: "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "EXPO_PUBLIC_FIREBASE_APP_ID",
};

const placeholderValues = new Set([
  "",
  "your-api-key",
  "your-project-id.firebaseapp.com",
  "your-project-id",
  "your-project-id.appspot.com",
  "your-sender-id",
  "your-app-id",
]);

let cachedApp: FirebaseApp | null = null;

export function getFirebaseConfigStatus() {
  const missingKeys = (Object.keys(firebaseConfig) as FirebaseConfigKey[]).filter((key) =>
    isMissingFirebaseValue(firebaseConfig[key])
  );

  return {
    isConfigured: missingKeys.length === 0,
    missingKeys,
    missingEnvNames: missingKeys.map((key) => firebaseEnvNames[key]),
  };
}

export function getFirebaseConfigErrorMessage(error?: unknown) {
  if (error instanceof FirebaseConfigError) {
    return `Firebase 설정값이 아직 비어 있습니다. .env 파일에 ${error.missingKeys
      .map((key) => firebaseEnvNames[key])
      .join(", ")} 값을 입력해주세요.`;
  }

  const status = getFirebaseConfigStatus();
  if (!status.isConfigured) {
    return `Firebase 설정값이 아직 비어 있습니다. .env 파일에 ${status.missingEnvNames.join(
      ", "
    )} 값을 입력해주세요.`;
  }

  return "Firebase 설정을 확인해주세요.";
}

export function getFirebaseApp() {
  if (getApps().length > 0) {
    cachedApp = getApps()[0];
    return cachedApp;
  }

  if (cachedApp) {
    return cachedApp;
  }

  const status = getFirebaseConfigStatus();
  if (!status.isConfigured) {
    throw new FirebaseConfigError(status.missingKeys);
  }

  cachedApp = initializeApp(firebaseConfig as FirebaseOptions);
  return cachedApp;
}

function isMissingFirebaseValue(value: string | undefined) {
  return !value || placeholderValues.has(value.trim());
}
