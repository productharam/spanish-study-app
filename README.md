# Spanish Study App (초기 버전) /. 2025-11-23

## 구현된 기능
1. 메인 화면
  - 들어가기 버튼

2. Juan과 대화하기
  - Juan에게 인사하기 (버튼)
  - 채팅 (API: /api/chat)
  - 문장 분석 (API: /api/details, /api/details-user)
    - GPT API 모델: gpt-5.1
  - TTS (API: /api/tts, ElevenLabs)
  
3. SEO로그인
  - 구글 로그인

4. 학습기능
  - 한글 -> 스페인어 변환 / 채점
  - 힌트



## 미구현 기능
- 암호화(내용 자체 암호화)
  - 지금은 안 해도 됨.
  - Supabase 기본 암호화 + RLS로도 충분.
  - 진짜 외부 유저 + 민감데이터 단계에서 고민해도 늦지 않음.
