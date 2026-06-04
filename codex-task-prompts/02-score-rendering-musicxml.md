이 프로젝트는 React Native + Expo로 만든 기타 악보 연습 앱이야.
현재 폴더는 `C:\Users\kis42\OneDrive\Desktop\real coding\digitalhighschoolproject` 이야.

이번 대화에서는 **악보 렌더링 / MusicXML 파싱만** 작업해줘.

현재 기능:
- MusicXML/MXL 악보를 WebView + OpenSheetMusicDisplay로 표시함.
- `src/musicxml/parseMusicXml.ts`에서 음표, 쉼표, 마디, duration, tempo, beats 정보를 파싱함.
- `src/webview/osmdPracticeHtml.ts`와 `src/components/ScoreWebView.tsx`가 악보 표시와 색상/라벨 제어를 담당함.
- 도돌이표, 쉼표, 겹음, 8분음표/16분음표 구분이 중요함.

목표:
- MusicXML 파싱이 실제 박자와 맞는지 확인하기.
- 4분음표, 8분음표, 16분음표가 정확히 구별되게 하기.
- 도돌이표가 자연스럽게 돌아가도록 하기.
- 악보 위 색 표시가 엉뚱한 왼쪽 상단에 뜨지 않게 하기.
- 악보는 스크롤 기준으로 편하게 볼 수 있게 유지하기.

작업 방법:
- 먼저 `src/musicxml/parseMusicXml.ts`, `src/webview/osmdPracticeHtml.ts`, `src/components/ScoreWebView.tsx`, `App.tsx`의 악보 관련 부분만 읽어줘.
- 로그인, Firebase, 성취도 UI, 피치 판정은 건드리지 마.
- 수정 후 `npm.cmd run typecheck`를 실행해줘.

