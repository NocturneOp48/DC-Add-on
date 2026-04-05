# DC Add-on

DCInside 갤러리 이용을 위한 Chrome 확장 프로그램

## Features

| 기능 | 설명 |
|------|------|
| **차단** | 유저 ID, IP(통신사 일괄 차단), 키워드 기반 필터링 |
| **빠른글보기** | 글 목록에서 클릭 시 인라인으로 본문 + 댓글 미리보기 |
| **자동 새로고침** | 설정한 간격(5~60초)으로 새 글 자동 로드 (개념글/말머리 탭 지원) |
| **추첨** | 댓글 작성자 목록에서 랜덤 추첨 |

## Install

1. 이 레포지토리를 클론하거나 ZIP 다운로드
2. Chrome에서 `chrome://extensions` 접속
3. **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 클릭 후 폴더 선택

## Structure

```
manifest.json         # Chrome Extension Manifest V3
content_scripts.js    # 메인 로직 (필터링, 빠른글보기, 자동새로고침, 추첨)
content_scripts.css   # shadcn/ui 기반 디자인 시스템
dom.js                # 경량 DOM 유틸리티
page_bridge.js        # MAIN world 스크립트 (댓글 로딩)
popup.html/css/js     # 팝업 UI (토글 + 액션 버튼)
```

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JS (no framework)
- `chrome.storage` for state, `chrome.runtime.onMessage` for popup-content communication
- `world: "MAIN"` content script for page context access (CSP bypass)
