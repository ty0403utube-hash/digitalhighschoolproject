이 프로젝트는 React Native + Expo로 만든 기타 악보 연습 앱이야.
현재 폴더는 `C:\Users\kis42\OneDrive\Desktop\real coding\digitalhighschoolproject` 이야.

이번 대화에서는 **로그인 / Firebase 연동만** 작업해줘.

현재 상황:
- 앱에 로그인/회원가입 화면이 있음.
- Firebase Auth 이메일/비밀번호 로그인을 연결하려는 중임.
- `src/firebase/firebaseApp.ts`, `src/firebase/auth.ts`, `src/firebase/firestoreSync.ts`, `src/firebase/storage.ts`가 있음.
- `.env.example`은 있음.
- `.env`에 실제 Firebase 설정값을 넣어야 함.

목표:
- Firebase Auth 로그인/회원가입/로그아웃이 제대로 동작하게 하기.
- Firebase 설정이 비어 있으면 앱이 죽지 않고 사용자에게 한국어 오류를 보여주기.
- iPad에서 키보드가 입력칸을 가리지 않게 하기.
- 나중에 Firestore/Storage 동기화와 연결하기 좋게 구조 정리하기.

작업 방법:
- 먼저 `App.tsx`, `src/firebase/*`, `app.json`, `package.json`을 읽고 현재 구조를 파악해줘.
- 악보 렌더링, 피치 분석, 취약 부분, 성취도 기능은 건드리지 마.
- 수정 후 `npm.cmd run typecheck`를 실행해서 확인해줘.
- Firebase Console에서 사용자가 직접 해야 하는 설정이 있으면 정확히 알려줘.

