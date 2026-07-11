<img width="2208" height="512" alt="ko" src="https://github.com/ivLis-Studio/ivLyrics/blob/main/preview_readme_ko.png?raw=true" />

---

<p align="center">
  <a href="README.md">한국어</a> |
  <a href="README_EN.md">English</a>
</p>

---

### ivLyrics - 당신의 언어로 즐기는, 그런 음악.


Spicetify용 가사 확장 프로그램입니다. AI API를 활용하여 다양한 언어의 발음 표기와 번역을 지원합니다.

버그 리포트 및 기능 제안은 GitHub Issues 또는 [Discord](https://discord.gg/2fu36fUzdE)를 통해 문의해주세요.

![preview](https://github.com/user-attachments/assets/0596a769-76aa-49c5-970c-85897fe8d260)

---

> [!IMPORTANT]
> ⚠️ 면책 조항 (Disclaimer)
>
> **비공식 프로젝트 안내**
>
> 본 프로젝트와 기여자는 Spotify, 또는 그 계열사 및 자회사와 어떠한 제휴, 권한 부여, 승인 또는 공식적인 연결 관계도 없음을 밝힙니다. **본 프로젝트는 데스크톱 경험 제공을 목적으로 자원봉사 팀이 개발한 독립적이고 비영리적인 비공식 확장 프로그램입니다.**
>
> **상표권 안내**
>
> "Spotify"라는 명칭을 포함하여 관련 명칭, 마크, 엠블럼 및 이미지는 해당 소유자의 등록 상표입니다. 이러한 상표의 사용은 식별 및 참조 목적으로만 사용되며, 상표권자와의 어떠한 연관성도 시사하지 않습니다. 본 프로젝트는 해당 상표권을 침해하거나 상표권자에게 피해를 줄 의도가 없음을 명시합니다.
>
> **책임의 한계**
>
> 본 애플리케이션(확장 프로그램)은 "있는 그대로(AS IS)" 제공되며, 사용 시 발생하는 위험은 전적으로 사용자의 책임입니다. 개발자 또는 기여자는 본 소프트웨어의 사용 또는 기타 거래와 관련하여 발생하는 청구, 손해 또는 법적 결과를 포함한 어떠한 책임도 지지 않습니다. 본 소프트웨어 사용으로 인한 모든 결과에 대한 책임은 전적으로 사용자에게 있습니다.
>
> **저작권 및 약관 준수**
>
> 본 프로젝트는 가사, 번역문, 영상 또는 기타 제3자 콘텐츠의 소유권을 주장하지 않으며, 해당 콘텐츠에 대한 라이선스를 부여하지도 않습니다. 사용자는 관련 저작권법, 플랫폼 정책, API 이용약관 및 현지 법령을 직접 확인하고 준수할 책임이 있으며, 본 프로젝트를 이용한 저장, 복제, 배포, 송신 또는 상업적 이용에 대한 책임은 전적으로 사용자에게 있습니다.
>


## 주요 기능

### 가사 번역 및 발음 표기
- Google Gemini API를 통한 실시간 가사 번역
- 일본어, 한국어, 중국어 등 다양한 언어의 로마자 발음 표기 지원
- 일본어 가사에 후리가나(ふりがな) 표시 기능

### 사용자 인터페이스
- 노래방 스타일 가사 표시 (단어별 하이라이트)
- 전체 화면 모드 지원
- 유튜브 뮤직비디오 배경 재생
- 가사별 싱크 오프셋 조정
- 커뮤니티 싱크 오프셋 공유 기능
- 다양한 폰트, 색상, 레이아웃 커스터마이징

### 지원 언어
한국어, 영어, 일본어, 중국어(간체/번체), 스페인어, 프랑스어, 독일어, 체코어, 이탈리아어, 러시아어, 스웨덴어, 포르투갈어, 아랍어, 페르시아어, 힌디어, 벵골어, 태국어, 터키어, 베트남어, 인도네시아어, 말레이어

---

## 가이드

#### 자동 설치 (권장)

Spicetify 설치 직후라면 PowerShell 또는 터미널을 재시작한 후 진행하세요.

##### Windows
```powershell
iwr -useb https://ivlis.kr/ivLyrics/install.ps1 | iex
```

##### macOS / Linux
```bash
curl -fsSL https://ivlis.kr/ivLyrics/install.sh | bash
```

업데이트도 동일한 명령어로 가능합니다.
자동 설치를 사용하면 Windows, macOS, Linux에서 `ivlyrics-updater://` 업데이트 도우미가 함께 등록되어 앱 안의 업데이트 버튼으로도 실행할 수 있습니다.

#### 삭제 방법

##### Windows
```powershell
iwr -useb https://ivlis.kr/ivLyrics/uninstall.ps1 | iex
```

##### macOS / Linux
```bash
curl -fsSL https://ivlis.kr/ivLyrics/uninstall.sh | bash
```

#### 수동 설치

1. [GitHub Releases](https://github.com/ivLis-Studio/ivLyrics/releases)에서 최신 버전을 다운로드합니다.
2. 압축을 해제하고 폴더 이름을 `ivLyrics`로 변경합니다.
3. 해당 폴더를 Spicetify CustomApps 디렉토리에 복사합니다:
   - Windows: `%LocalAppData%\spicetify\CustomApps`
   - macOS/Linux: `~/.config/spicetify/CustomApps`
4. 터미널에서 다음 명령어를 실행합니다:
   ```
   spicetify config custom_apps ivLyrics
   spicetify apply
   ```

---

## 초기 설정

1. 플레이어를 실행하고 좌측 메뉴에서 ivLyrics를 선택합니다.
2. 우측 하단의 설정 버튼을 클릭합니다.
3. 고급 탭에서 Gemini API 키를 입력합니다.
   - API 키는 [Google AI Studio](https://aistudio.google.com/apikey?hl=ko)에서 무료로 발급받을 수 있습니다.
4. 음악을 재생하고 가사 영역에 마우스를 올리면 나타나는 변환 버튼을 클릭하여 번역/발음 모드를 활성화합니다.

---

## 문제 해결

### 초기화 방법

설정이나 가사 표시에 문제가 있는 경우:

1. 터미널에서 `spicetify enable-devtools` 명령어를 실행합니다.
2. 창에서 우클릭 후 "Inspect Element" 또는 "개발자 도구"를 선택합니다.
3. Application 탭 > Storage > "Clear site data"를 클릭합니다.
4. 음악 프로그램을 클릭하고 Ctrl+Shift+R (macOS: Cmd+Shift+R)을 눌러 새로고침합니다.

### 자주 발생하는 문제

- **가사가 표시되지 않음**: 인터넷 연결을 확인하거나 다른 노래를 재생해보세요.
- **번역이 작동하지 않음**: Gemini API 키가 올바르게 입력되었는지 확인하세요.
- **Spicetify가 실행되지 않음**: `spicetify restore` 후 `spicetify apply`를 다시 실행하세요.

---

## 후원

개발을 지원해주시려면 커피 한 잔 사주세요.

<a href="https://www.buymeacoffee.com/ivlis" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>


## 크레딧

Original <a href="https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus">Lyrics-Plus</a> Project by spicetify 
