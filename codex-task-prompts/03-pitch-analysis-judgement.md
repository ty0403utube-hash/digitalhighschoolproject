이 프로젝트는 React Native + Expo로 만든 기타 악보 연습 앱이야.
현재 폴더는 `C:\Users\kis42\OneDrive\Desktop\real coding\digitalhighschoolproject` 이야.

이번 대화에서는 **연주 판정 / 피치 분석만** 작업해줘.

현재 기능:
- WebView 마이크 입력으로 pitch detection을 함.
- FFT도 사용함.
- 빠른 음은 어택 순간의 피치 샘플을 모아서 판정함.
- 사람 목소리를 최대한 배제하려고 기타 어택 기준을 사용함.
- 기타는 실제 소리가 악보보다 한 옥타브 낮게 나는 점을 반영함.
- 연습 BPM을 사용자가 바꿀 수 있음.

목표:
- 정확도를 높이기.
- 감지 안 됨이 너무 많이 뜨는 문제 줄이기.
- 빠른 음에서 음 판정이 너무 틀리지 않도록 하기.
- 연주 중에는 BPM을 바꿀 수 없게 유지하기.
- 음 허용 기준과 박자 허용 기준을 코드상에서 명확히 정리하기.

작업 방법:
- 먼저 `App.tsx`의 pitch/FFT/attack/BPM 관련 함수와 `src/webview/osmdPracticeHtml.ts`의 마이크 분석 부분을 읽어줘.
- 악보 렌더링, Firebase, 성취도 UI는 건드리지 마.
- 수정 후 `npm.cmd run typecheck`를 실행해줘.

