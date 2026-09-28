# Global YouTube Radar
전 세계 YouTube 영상의 조회수 스냅샷을 저장하고 10분/1시간/6시간/24시간 증가량으로 정렬하는 대시보드입니다.

## 시작
1. Node.js 20+ 설치
2. `.env.example`을 `.env`로 복사하고 `YOUTUBE_API_KEY` 입력
3. `npm install`
4. `npm start`
5. 브라우저에서 `http://localhost:3000`

## API 키
Google Cloud Console에서 YouTube Data API v3를 활성화하고 API 키를 발급하세요. 키는 절대 public 폴더나 브라우저 코드에 넣지 마세요.

## 중요
YouTube Data API만으로 전 세계 모든 업로드 영상을 실시간 전수 조사할 수는 없습니다. 이 기본판은 국가별 `mostPopular` 후보군을 수집·추적합니다. TOP 500의 품질을 높이려면 후보 발견 전략, 스케줄러, 국가 순환 수집 및 API quota 관리가 추가로 필요합니다.

Shorts 판별은 영상 길이를 이용한 근사치입니다. YouTube의 Shorts 분류와 완전히 동일하다고 보장할 수 없습니다.
